/**
 * How the run walks the tree (pure, cached per timeline): the innermost running call of a traversal
 * function — its node argument is the current node — and the calls above it (the path being processed);
 * where one walk ends and the next begins (a new top-level traversal or node-taking call, or the first
 * visit-order array a walk makes); the visits (a traversal call on a node returned, or the node's value was
 * pushed to a visit-order array); and which visit-order array is in use at each step.
 */
import { frameById } from '../../engine/timeline/scope';
import type { CallNode, HeapChange, Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import { isRef, isUndef, sameV, type ObjId, type V } from '../../engine/types/values';
import type { TreeBindings } from './detect';
import { isBinary } from './structure';

export interface Push {
  step: number;
  /** element index the value landed at */
  index: number;
  /** the node whose value was pushed, when known */
  node: ObjId | null;
}

export interface OutputArray {
  id: ObjId;
  allocStep: number;
  pushes: Push[];
  maxLen: number;
}

/** The node class's own constructor (a class or a constructor function): it only wires a new node up. */
export function isNodeCtor(tl: Timeline, fnId: number, cls: string | undefined): boolean {
  const fn = tl.meta.fns[fnId];
  return cls !== undefined && fn !== undefined && (fn.kind === 'ctor' ? fn.className : fn.name) === cls;
}

/** Argument position taking nodes, per function: the first position any call passes a node at. */
export function nodeArgPositions(tl: Timeline, nodes: ReadonlySet<ObjId>): Map<number, number> {
  const out = new Map<number, number>();
  for (const call of tl.calls.values()) {
    if (out.has(call.fnId)) continue;
    const k = call.args.findIndex((v) => nodes.has(refId(v) ?? -1));
    if (k >= 0) out.set(call.fnId, k);
  }
  return out;
}

export function nodeArg(call: CallNode, pos: ReadonlyMap<number, number>, nodes: ReadonlySet<ObjId>): ObjId | null {
  const k = pos.get(call.fnId);
  const id = k === undefined ? null : refId(call.args[k]);
  return id !== null && nodes.has(id) ? id : null;
}

const callerOf = (tl: Timeline, call: CallNode) => (call.parentId === call.callId ? undefined : tl.calls.get(call.parentId));

/** The innermost traversal call at or above `call` still running at step i. */
function runningFrom(tl: Timeline, fns: ReadonlySet<number>, call: CallNode | undefined, i: number): CallNode | null {
  for (let c = call; c; c = callerOf(tl, c)) if (fns.has(c.fnId) && (c.exitStep === undefined || c.exitStep > i)) return c;
  return null;
}

/** The innermost running call of a traversal function at step i (helpers it calls belong to it). */
export function activeCall(tl: Timeline, fns: ReadonlySet<number>, i: number): CallNode | null {
  return runningFrom(tl, fns, tl.calls.get(tl.steps[i]?.callId ?? -1), i);
}

/** The traversal call `call` was made from (directly or through helpers), if any. */
export function parentCall(tl: Timeline, fns: ReadonlySet<number>, call: CallNode): CallNode | null {
  for (let c = callerOf(tl, call); c; c = callerOf(tl, c)) if (fns.has(c.fnId)) return c;
  return null;
}

/** No traversal call runs where step i's code ran (a call step's allocations belong to the caller). */
function outsideWalk(tl: Timeline, fns: ReadonlySet<number>, i: number): boolean {
  const step = tl.steps[i];
  const call = tl.calls.get(step?.callId ?? -1);
  return runningFrom(tl, fns, step?.kind === 'call' && call ? callerOf(tl, call) : call, i) === null;
}

/** Values a change adds to an array, with the index each lands at. */
export function additions(h: HeapChange): { index: number; v: V }[] {
  const at = typeof h.path[0] === 'number' ? h.path[0] : 0;
  if (h.op === 'push' || h.op === 'unshift' || h.op === 'splice') return (h.args ?? []).map((v, k) => ({ index: at + k, v }));
  return h.op === 'set' && typeof h.path[0] === 'number' && h.value !== undefined ? [{ index: at, v: h.value }] : [];
}

/** The node whose value `v` is at step s: one read there, else one held by a variable of the step's frame. */
function pushedNode(tl: Timeline, s: number, v: V, nodes: ReadonlySet<ObjId>, valueKey: string | undefined): ObjId | null {
  if (valueKey === undefined || isRef(v)) return null;
  const reads = tl.diffs[s].reads;
  for (let k = reads.length - 1; k >= 0; k--) {
    const r = reads[k];
    if (nodes.has(r.id) && r.path[0] === valueKey && sameV(r.value, v)) return r.id;
  }
  const snap = tl.snapshots[s];
  for (const slot of frameById(snap, tl.steps[s].callId)?.vars.values() ?? []) {
    const id = refId(slot.v);
    if (id !== null && nodes.has(id) && sameV(snap.heap.get(id)?.props?.get(valueKey)?.v, v)) return id;
  }
  return null;
}

/** Every array's additions (attributed to nodes where possible); `drained`: arrays that lost elements. */
function scanArrays(tl: Timeline, nodes: ReadonlySet<ObjId>, valueKey: string | undefined, only?: ReadonlySet<ObjId>) {
  const arrays = new Map<ObjId, OutputArray>();
  const drained = new Set<ObjId>();
  tl.diffs.forEach((d, s) => {
    const heap = tl.snapshots[s].heap;
    for (const h of d.heap) {
      if (only && !only.has(h.id)) continue;
      const len = heap.get(h.id)?.elems?.size ?? 0;
      if (h.op === 'alloc') {
        if (heap.get(h.id)?.kind === 'array') arrays.set(h.id, { id: h.id, allocStep: s, pushes: [], maxLen: len });
        continue;
      }
      const o = arrays.get(h.id);
      if (!o) continue;
      if (h.op === 'shift' || h.op === 'pop' || (h.op === 'splice' && h.removed?.length)) drained.add(h.id);
      for (const { index, v } of additions(h)) o.pushes.push({ step: s, index, node: pushedNode(tl, s, v, nodes, valueKey) });
      o.maxLen = Math.max(o.maxLen, len);
    }
  });
  return { arrays, drained };
}

const firstVisit = (o: OutputArray) => o.pushes.find((p) => p.node !== null)?.step ?? Infinity;

/**
 * Arrays the visit order is pushed to: they receive node values, never lose elements (queues and paths
 * do), are not held by a node, and are made outside any traversal call (not a call's own scratch list).
 */
export function findOutputs(tl: Timeline, nodes: ReadonlySet<ObjId>, fns: ReadonlySet<number>, valueKey: string | undefined,
  held: ReadonlySet<ObjId>): OutputArray[] {
  const { arrays, drained } = scanArrays(tl, nodes, valueKey);
  return [...arrays.values()]
    .filter((o) => !held.has(o.id) && !drained.has(o.id) && firstVisit(o) < Infinity && outsideWalk(tl, fns, o.allocStep))
    .sort((x, y) => firstVisit(x) - firstVisit(y));
}

export interface WalkFacts {
  nodes: ReadonlySet<ObjId>;
  fns: ReadonlySet<number>;
  /** node argument position per function */
  pos: ReadonlyMap<number, number>;
  /** the bindings' visit-order arrays */
  outputs: OutputArray[];
  /** first steps of the walks, ascending */
  starts: number[];
  /** by step: a traversal call on the node returned, or its value was pushed */
  visits: { step: number; node: ObjId }[];
  /** by step: numbers, strings and booleans traversal calls on nodes returned */
  returns: { step: number; node: ObjId; value: V }[];
  /** per step: the visit-order array in use (-1: none yet) */
  activeOutput: number[];
}

/** What a node's badge can show. */
const isPlain = (v: V | undefined): v is V =>
  typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'object' && v !== null && ('n' in v || 's' in v || 'big' in v));

/** Latest of the ascending `starts` at or before i (-1: none). */
function latestStart(starts: readonly number[], i: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= i) {
      best = starts[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function computeFacts(tl: Timeline, b: TreeBindings): WalkFacts {
  const nodes = new Set(b.nodeIds);
  const fns = new Set(b.traversalFns);
  const pos = nodeArgPositions(tl, nodes);
  const ids = new Set(b.outputs.map((o) => o.objId));
  const { arrays } = scanArrays(tl, nodes, b.valueKey, ids);
  const outputs = b.outputs.map((o) => arrays.get(o.objId)).filter((o) => o !== undefined);
  const visits: WalkFacts['visits'] = [];
  const returns: WalkFacts['returns'] = [];
  const starts = new Set<number>();
  // steps at which a visit-order array comes into use
  const touches: [number, ObjId][] = [];
  for (const call of tl.calls.values()) {
    const fn = tl.meta.fns[call.fnId];
    const node = nodeArg(call, pos, nodes);
    const top = parentCall(tl, fns, call) === null;
    if (!fns.has(call.fnId)) {
      if (top && node !== null && fn && !fn.isCallback && !isNodeCtor(tl, call.fnId, b.nodeShape)) starts.add(call.enterStep);
      continue;
    }
    if (top) starts.add(call.enterStep);
    for (const a of call.args) {
      const id = refId(a);
      if (id !== null && ids.has(id)) touches.push([call.enterStep, id]);
    }
    if (node === null || call.returnStep === undefined || call.threw) continue;
    visits.push({ step: call.returnStep, node });
    if (isPlain(call.value)) returns.push({ step: call.returnStep, node, value: call.value });
  }
  const callStarts = [...starts].sort((x, y) => x - y);
  let lastAlloc = -Infinity;
  for (const o of [...outputs].sort((x, y) => x.allocStep - y.allocStep)) {
    // the first visit-order array made since the walk began starts a fresh one (a loop over the tree)
    if (lastAlloc < latestStart(callStarts, o.allocStep)) starts.add(o.allocStep);
    lastAlloc = o.allocStep;
    touches.push([o.allocStep, o.id]);
    for (const p of o.pushes) {
      touches.push([p.step, o.id]);
      if (p.node !== null) visits.push({ step: p.step, node: p.node });
    }
  }
  touches.sort((x, y) => x[0] - y[0]);
  const activeOutput: number[] = [];
  for (let i = 0, k = 0, cur = -1; i < tl.steps.length; i++) {
    while (k < touches.length && touches[k][0] <= i) cur = touches[k++][1];
    activeOutput.push(cur);
  }
  return {
    nodes, fns, pos, outputs, starts: [...starts].sort((x, y) => x - y), visits: visits.sort((x, y) => x.step - y.step),
    returns: returns.sort((x, y) => x.step - y.step), activeOutput,
  };
}

const cache = new WeakMap<Timeline, Map<string, { n: number; facts: WalkFacts }>>();

export function walkFacts(tl: Timeline, b: TreeBindings): WalkFacts {
  let byKey = cache.get(tl);
  if (!byKey) {
    byKey = new Map();
    cache.set(tl, byKey);
  }
  const key = `${b.nodeShape}|${b.traversalFns.join(',')}|${b.outputs.map((o) => o.objId).join(',')}`;
  const hit = byKey.get(key);
  if (hit && hit.n === tl.steps.length) return hit.facts;
  const facts = computeFacts(tl, b);
  byKey.set(key, { n: tl.steps.length, facts });
  return facts;
}

/** First step of the walk step i belongs to (0 before any). */
export const walkStart = (facts: WalkFacts, i: number) => Math.max(0, latestStart(facts.starts, i));

/** Nodes visited so far in the walk step i belongs to. */
export function visitedAt(facts: WalkFacts, i: number): Set<ObjId> {
  const from = walkStart(facts, i);
  return new Set(facts.visits.filter((v) => v.step >= from && v.step <= i).map((v) => v.node));
}

/** What each node's latest finished traversal call of this walk returned. */
export function returnedAt(facts: WalkFacts, i: number): Map<ObjId, V> {
  const from = walkStart(facts, i);
  const out = new Map<ObjId, V>();
  for (const r of facts.returns) if (r.step >= from && r.step <= i) out.set(r.node, r.value);
  return out;
}

/** Which child key of `parent` was read at `step` to get `child` (null: a missing child) — binary trees. */
export function readSlot(tl: Timeline, step: number, b: TreeBindings, parent: ObjId, child: ObjId | null): number | null {
  if (!isBinary(b)) return null;
  const reads = tl.diffs[step]?.reads ?? [];
  for (let k = reads.length - 1; k >= 0; k--) {
    const r = reads[k];
    const slot = b.childKeys.indexOf(String(r.path[0]));
    const gave = child === null ? r.value === null || isUndef(r.value) : refId(r.value) === child;
    if (r.id === parent && slot >= 0 && gave) return slot;
  }
  return null;
}

export interface WalkState {
  /** a traversal call is running */
  active: boolean;
  /** the node it works on (null: it got null, or none runs) */
  current: ObjId | null;
  /** nodes of the traversal calls above it, root first */
  path: ObjId[];
  /** it got null: whose child that was (null: a top-level call on an empty tree) and which one, when known */
  nullChild: { parent: ObjId | null; slot: number | null } | null;
}

export function walkAt(tl: Timeline, i: number, b: TreeBindings, facts: WalkFacts): WalkState {
  const call = activeCall(tl, facts.fns, i);
  if (!call) return { active: false, current: null, path: [], nullChild: null };
  const path: ObjId[] = [];
  for (let p = parentCall(tl, facts.fns, call); p; p = parentCall(tl, facts.fns, p)) {
    const n = nodeArg(p, facts.pos, facts.nodes);
    if (n !== null) path.unshift(n);
  }
  const current = nodeArg(call, facts.pos, facts.nodes);
  const up = parentCall(tl, facts.fns, call);
  const parent = up ? nodeArg(up, facts.pos, facts.nodes) : null;
  // a caller that itself got null has nothing to point at
  const nullChild = current !== null || (up !== null && parent === null) ? null
    : { parent, slot: parent === null ? null : readSlot(tl, call.enterStep, b, parent, null) };
  return { active: true, current, path, nullChild };
}
