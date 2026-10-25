/**
 * Queues: arrays filled at one end and drained at the other. Modes:
 *  fifo (push + shift, unshift + pop, or `queue[head++]` while pushing) · deque (both ends used) ·
 *  priority (re-sorted between additions and removals: `pq.sort(…); pq.shift()`).
 * The holder is the variable that got the array when it was created; class / object queues
 * (`q.enqueue(x)` over `this.items`) are held through the object whose property stores the array.
 */
import { resolveVarKey, type ObjInfo, type TraceAnalysis, type VarInfo } from '../../engine/detect/analysis';
import { trackVar, varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ObjId } from '../../engine/types/values';
import type { DetectContext, Detection } from '../types';

export type QueueMode = 'fifo' | 'deque' | 'priority';

export interface QueueBindings {
  target: VarRef;
  /** the items array (the first one when the holder is re-bound to new queues) */
  objId: ObjId;
  mode: QueueMode;
  /** head-index queue: the logical queue is elems[head..] */
  head?: VarRef;
  /** the logical front is the array's end (unshift + pop queues, priority queues extracting with pop) */
  frontAtEnd?: boolean;
  /** class / object queues: the items array is this property of the object `target` holds */
  prop?: string;
}

export const QUEUE_SCORE = 0.85;

/** head-index names: head, qHead, front, qi, … */
const HEADISH = /head|front|^(h|hd|qi|qh|qp|ptr|read|rd|first|cursor)$/i;
/** methods that make an object holding an array read as the queue itself (`q` rather than `q.items`) */
const QUEUE_METHODS = /^(enqueue|dequeue|offer|poll|push|shift|unshift|pop|add|remove|insert|peek|front|enq|deq|extract\w*)$/i;

interface Usage {
  push: number;
  unshift: number;
  shift: number;
  pop: number;
  sort: number;
  /** removals made while the array was still sorted (no addition since the last sort) */
  sortedRemovals: number;
  /** sorts after the array changed since the previous sort */
  resorts: number;
}

const emptyUsage = (): Usage => ({ push: 0, unshift: 0, shift: 0, pop: 0, sort: 0, sortedRemovals: 0, resorts: 0 });

function addUsage(into: Usage, u: Usage): void {
  for (const k of Object.keys(into) as (keyof Usage)[]) into[k] += u[k];
}

const isIntVar = (v: VarInfo) => v.kinds.has('int') && [...v.kinds].every((k) => k === 'int' || k === 'undefined' || k === 'null');

/** How each array is filled and drained, in trace order (a removal right after a sort comes out in priority order). */
function usageOf(tl: Timeline, ids: ReadonlySet<ObjId>): Map<ObjId, Usage> {
  const out = new Map<ObjId, Usage>();
  const state = new Map<ObjId, { sorted: boolean; changed: boolean }>();
  for (const d of tl.diffs) {
    for (const h of d.heap) {
      if (!ids.has(h.id) || h.op === 'alloc') continue;
      const u = out.get(h.id) ?? emptyUsage();
      const s = state.get(h.id) ?? { sorted: false, changed: false };
      out.set(h.id, u);
      state.set(h.id, s);
      // `splice(0, k)` drains the front like shift
      const op = h.op === 'splice' && h.path[0] === 0 && h.removed?.length && !h.args?.length ? 'shift' : h.op;
      if (op === 'push' || op === 'unshift') {
        u[op] += 1;
        s.sorted = false;
        s.changed = true;
      } else if (op === 'shift' || op === 'pop') {
        u[op] += 1;
        if (s.sorted) u.sortedRemovals += 1;
        s.changed = true;
      } else if (op === 'sort') {
        if (u.sort > 0 && s.changed) u.resorts += 1;
        u.sort += 1;
        s.sorted = true;
        s.changed = false;
      } else {
        s.sorted = false;
        s.changed = true;
      }
    }
  }
  return out;
}

function modeOf(u: Usage): { mode: QueueMode; frontAtEnd: boolean } | null {
  if (u.shift + u.pop === 0) return null;
  if (u.sort >= 2 && u.resorts >= 1 && u.sortedRemovals >= 1) return { mode: 'priority', frontAtEnd: u.pop > u.shift };
  if ((u.push > 0 && u.unshift > 0) || (u.pop > 0 && u.shift > 0)) return { mode: 'deque', frontAtEnd: false };
  if (u.push > 0 && u.shift > 0) return { mode: 'fifo', frontAtEnd: false };
  if (u.unshift > 0 && u.pop > 0) return { mode: 'fifo', frontAtEnd: true };
  return null;
}

/** For other detectors: array `objId` is re-sorted between additions and removals — a priority queue, not a sorting array. */
export function isPriorityQueue(tl: Timeline, objId: ObjId): boolean {
  const u = usageOf(tl, new Set([objId])).get(objId);
  return u !== undefined && modeOf(u)?.mode === 'priority';
}

/** `queue[head++]` while pushing: one of the rising `heads` (head, front, …) matching the indexes read. */
function headOf(tl: Timeline, o: ObjInfo, u: Usage, heads: VarInfo[]): VarRef | undefined {
  if (!heads.length || o.reads < 2 || u.push === 0 || u.shift + u.unshift + u.pop + u.sort > 0) return undefined;
  const reads: { step: number; index: number }[] = [];
  for (let s = o.allocStep; s < tl.diffs.length; s++) {
    for (const r of tl.diffs[s].reads) if (r.id === o.id && typeof r.path[0] === 'number') reads.push({ step: s, index: r.path[0] });
  }
  let best: VarRef | undefined;
  let bestHits = 1;
  for (const v of heads) {
    const values = trackVar(tl, v.ref);
    // read at the old value (`queue[head++]`) or the current one (`queue[head]; head++`)
    const hits = reads.filter((r) => values[r.step - 1] === r.index || values[r.step] === r.index).length;
    if (hits > bestHits) {
      best = v.ref;
      bestHits = hits;
    }
  }
  return best;
}

/** The object (class instance / record) whose property holds array `id`. */
function ownerOf(tl: Timeline, a: TraceAnalysis, id: ObjId): { obj: ObjInfo; prop: string } | null {
  for (const d of tl.diffs) {
    for (const h of d.heap) {
      if (h.op !== 'set' || h.path.length !== 1 || typeof h.path[0] !== 'string' || refId(h.value) !== id) continue;
      const obj = a.objects.get(h.id);
      if (obj?.kind === 'object') return { obj, prop: h.path[0] };
    }
  }
  // object literals (`{ items: [] }`) carry the array from their allocation
  for (const heapObj of tl.snapshots[tl.snapshots.length - 1].heap.values()) {
    const obj = a.objects.get(heapObj.id);
    if (heapObj.kind !== 'object' || !heapObj.props || !obj) continue;
    for (const [prop, slot] of heapObj.props) if (refId(slot.v) === id) return { obj, prop };
  }
  return null;
}

interface Holder {
  target: VarRef;
  prop?: string;
  owner?: ObjInfo;
}

const earliest = (vars: VarInfo[]) => [...vars].sort((x, y) => x.firstStep - y.firstStep)[0];

function varsOf(a: TraceAnalysis, o: ObjInfo): VarInfo[] {
  return [...o.varKeys].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
}

/** The variable assigned the array as it was created, else the variable of an object holding it, else any variable. */
function holderOf(tl: Timeline, a: TraceAnalysis, o: ObjInfo): Holder | null {
  const vars = varsOf(a, o);
  const atAlloc = vars.filter((v) => tl.diffs[o.allocStep]?.vars.some((c) => v.ref.bids.includes(c.bid) && refId(c.value) === o.id));
  if (atAlloc.length) return { target: earliest(atAlloc).ref };
  const owner = ownerOf(tl, a, o.id);
  const ownerVar = owner ? earliest(varsOf(a, owner.obj)) : undefined;
  if (owner && ownerVar) return { target: ownerVar.ref, prop: owner.prop, owner: owner.obj };
  return vars.length ? { target: earliest(vars).ref } : null;
}

/** Queue-like methods are called on the holder (`q.enqueue(x)`): the object is the queue. */
function callsQueueMethods(ctx: DetectContext, target: VarRef): boolean {
  const key = varKey(target);
  return ctx.tl.meta.analysis.methodCalls.some((m) => m.object === target.name && QUEUE_METHODS.test(m.method)
    && resolveVarKey(ctx.analysis, m.object, m.fnId) === key);
}

interface Group {
  holder: Holder;
  objs: ObjInfo[];
  owners: ObjInfo[];
  usage: Usage;
  head?: VarRef;
}

export function detectQueues(ctx: DetectContext): Detection<QueueBindings>[] {
  const { tl, analysis: a } = ctx;
  const arrays = [...a.objects.values()].filter((o) => o.kind === 'array'
    && (o.ops.push ?? 0) + (o.ops.unshift ?? 0) + (o.ops.shift ?? 0) + (o.ops.pop ?? 0) + (o.ops.splice ?? 0) > 0);
  const usage = usageOf(tl, new Set(arrays.map((o) => o.id)));
  const heads = [...a.vars.values()].filter((v) => HEADISH.test(v.ref.name) && isIntVar(v) && v.incs > 0 && v.decs === 0);
  // one detection per holder: a function called twice re-binds its queue variable to a new array
  const groups = new Map<string, Group>();
  for (const o of arrays) {
    const u = usage.get(o.id) ?? emptyUsage();
    const head = modeOf(u) ? undefined : headOf(tl, o, u, heads);
    if (!modeOf(u) && !head) continue;
    const holder = holderOf(tl, a, o);
    if (!holder) continue;
    const key = `${varKey(holder.target)}${holder.prop ? `.${holder.prop}` : ''}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { holder, objs: [o], owners: holder.owner ? [holder.owner] : [], usage: { ...u }, head });
      continue;
    }
    g.objs.push(o);
    if (holder.owner) g.owners.push(holder.owner);
    addUsage(g.usage, u);
    g.head ??= head;
  }
  const out: Detection<QueueBindings>[] = [];
  for (const [key, g] of groups) {
    const m = modeOf(g.usage);
    const { target, prop } = g.holder;
    const claims = new Set([varKey(target)]);
    for (const o of [...g.objs, ...g.owners]) {
      claims.add(`obj:${o.id}`);
      for (const k of o.varKeys) claims.add(k);
    }
    const mode = m?.mode ?? 'fifo';
    out.push({
      vizId: 'queue',
      key: `queue:${key}`,
      title: prop && !callsQueueMethods(ctx, target) ? `${target.name}.${prop}` : target.name,
      score: QUEUE_SCORE,
      role: 'primary',
      mode,
      claims: [...claims],
      bindings: {
        target, objId: g.objs[0].id, mode,
        ...(m ? {} : { head: g.head }),
        ...(m?.frontAtEnd ? { frontAtEnd: true } : {}),
        ...(prop ? { prop } : {}),
      },
    });
  }
  return out;
}
