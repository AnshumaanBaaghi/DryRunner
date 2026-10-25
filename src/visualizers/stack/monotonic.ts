/**
 * Monotonic stacks: at every step the elements run one way bottom → top — compared by the values they
 * index when they are indexes into a numeric array (`nums[stack[stack.length - 1]]`) — and every pop
 * follows a look at the top and makes room for the next element pushed (a decreasing stack pops 2
 * because 4 comes in: `2 < 4`). An index outside the indexed array (a `-1` sentinel) is skipped.
 */
import type { TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { valueAt, type VarRef } from '../../engine/detect/track';
import type { HeapObj, Timeline } from '../../engine/timeline/types';
import { primitive, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import { nextPush, peekAt, stackOps, type StackOp } from './ops';

export type Direction = 'decreasing' | 'increasing';
/** what elements are compared by */
export type Rank = number | string;

export interface MonotonicInfo {
  direction: Direction;
  /** the array the elements index (`nums` for a stack of indexes into nums) */
  values?: VarRef;
}

const MIN_MONOTONIC_POPS = 3;
/** reads of an array at an index the stack holds before the elements count as indexes into it */
const MIN_LINKS = 2;

export const fmtRank = (r: Rank) => (typeof r === 'string' ? `'${r}'` : String(r));
/** a rank, not a sentinel or an incomparable element */
export const isRank = (r: Rank | null | undefined): r is Rank => r !== null && r !== undefined;

/** The array the elements index at step i (through its variable). */
export function indexedAt(tl: Timeline, values: VarRef | undefined, i: number): HeapObj | undefined {
  const id = values ? refId(valueAt(tl, values, i)) : null;
  return id === null ? undefined : tl.snapshots[i]?.heap.get(id);
}

/**
 * What an element is compared by: its value in `indexed`, or itself (a number or a string) without one.
 * undefined: a sentinel index outside `indexed`; null: not comparable.
 */
export function rankOf(tl: Timeline, elem: V, indexed: HeapObj | undefined): Rank | null | undefined {
  const p = primitive(tl, elem).value;
  if (!indexed) return typeof p === 'string' || (typeof p === 'number' && !Number.isNaN(p)) ? p : null;
  if (typeof p !== 'number' || !Number.isInteger(p)) return null;
  if (p < 0 || p >= (indexed.elems?.size ?? 0)) return undefined;
  const v = primitive(tl, indexed.elems?.get(p)).value;
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

/** How a popped element compares to the incoming one when that comparison is why it left, else null. */
export function evictionRelation(direction: Direction, popped: Rank, incoming: Rank): string | null {
  if (typeof popped !== typeof incoming) return null;
  if (direction === 'decreasing') return popped < incoming ? '<' : popped === incoming ? '≤' : null;
  return popped > incoming ? '>' : popped === incoming ? '≥' : null;
}

export interface Eviction {
  popped: Rank;
  incoming: Rank;
  relation: string;
}

/** Ranks of the k-th op's element (a pop) and of the next element pushed; null without one or for a sentinel. */
function popAgainstNext(tl: Timeline, ops: StackOp[], k: number, values: VarRef | undefined): { popped: Rank; incoming: Rank } | null {
  const next = nextPush(ops, k);
  if (!next) return null;
  const popped = rankOf(tl, ops[k].value, indexedAt(tl, values, ops[k].step));
  const incoming = rankOf(tl, next.value, indexedAt(tl, values, next.step));
  return isRank(popped) && isRank(incoming) ? { popped, incoming } : null;
}

/** The pop of element `index` of array `objId` at `step`, explained by the element pushed next — or null. */
export function evictionAt(tl: Timeline, objId: ObjId, step: number, index: number, mono: MonotonicInfo): Eviction | null {
  const ops = stackOps(tl, objId);
  const k = ops.findIndex((op) => op.op === 'pop' && op.step === step && op.index === index);
  const pair = k < 0 ? null : popAgainstNext(tl, ops, k, mono.values);
  const relation = pair && evictionRelation(mono.direction, pair.popped, pair.incoming);
  return pair && relation ? { ...pair, relation } : null;
}

/** Order between neighbours bottom → top (sentinels skipped); null when an element is not comparable. */
function trendOf(ranks: (Rank | null | undefined)[]): { up: boolean; down: boolean } | null {
  let up = false;
  let down = false;
  let prev: Rank | undefined;
  for (const r of ranks) {
    if (r === null) return null;
    if (r === undefined) continue;
    if (prev !== undefined) {
      if (typeof r !== typeof prev) return null;
      up ||= r > prev;
      down ||= r < prev;
    }
    prev = r;
  }
  return { up, down };
}

/** The numeric array most often read at an index the stack holds (or pops) at that step. */
function indexedArray(tl: Timeline, a: TraceAnalysis, objIds: ObjId[]): ObjId | null {
  const own = new Set(objIds);
  const links = new Map<ObjId, number>();
  for (let s = 0; s < tl.diffs.length; s++) {
    const d = tl.diffs[s];
    if (!d.reads.some((r) => !own.has(r.id))) continue;
    const held = new Set<number>();
    for (const id of objIds) for (const e of tl.snapshots[s].heap.get(id)?.elems ?? []) if (typeof e === 'number') held.add(e);
    for (const h of d.heap) if (own.has(h.id) && h.op === 'pop' && typeof h.old === 'number') held.add(h.old);
    for (const r of d.reads) {
      const o = a.objects.get(r.id);
      if (own.has(r.id) || !o || (o.kind !== 'array' && o.kind !== 'typed') || !o.numeric || o.nested) continue;
      if (typeof r.path[0] === 'number' && held.has(r.path[0])) links.set(r.id, (links.get(r.id) ?? 0) + 1);
    }
  }
  let best: ObjId | null = null;
  for (const [id, n] of links) if (n >= MIN_LINKS && (best === null || n > links.get(best)!)) best = id;
  return best;
}

/** The variable standing for array `objId`: one in the stack's function first, then the earliest. */
function varOf(a: TraceAnalysis, objId: ObjId, fnId: number): VarRef | undefined {
  const vars = [...(a.objects.get(objId)?.varKeys ?? [])].map((k) => a.vars.get(k))
    .filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
  vars.sort((x, y) => Number(y.ref.fnId === fnId) - Number(x.ref.fnId === fnId) || x.firstStep - y.firstStep);
  return vars[0]?.ref;
}

/** The top was read since the stack's previous push / pop (the comparison deciding the k-th op, a pop). */
function peekedBefore(tl: Timeline, objId: ObjId, ops: StackOp[], k: number): boolean {
  for (let s = ops[k].step; s > (ops[k - 1]?.step ?? -1); s--) if (peekAt(tl, objId, s)) return true;
  return false;
}

/** Monotonic order of the arrays a stack variable holds (`fnId`: its function), or undefined. */
export function detectMonotonic(tl: Timeline, a: TraceAnalysis, objIds: ObjId[], fnId: number): MonotonicInfo | undefined {
  const all = objIds.map((id) => stackOps(tl, id));
  if (all.flat().filter((op) => op.op === 'pop').length < MIN_MONOTONIC_POPS) return undefined;
  const x = indexedArray(tl, a, objIds);
  const values = x === null ? undefined : varOf(a, x, fnId);
  let up = false;
  let down = false;
  for (const id of objIds) {
    for (let s = 0; s < tl.diffs.length; s++) {
      if (!tl.diffs[s].heap.some((h) => h.id === id)) continue;
      const indexed = indexedAt(tl, values, s);
      const t = trendOf((tl.snapshots[s].heap.get(id)?.elems?.toArray() ?? []).map((e) => rankOf(tl, e, indexed)));
      if (!t || (t.up && t.down)) return undefined;
      up ||= t.up;
      down ||= t.down;
    }
  }
  if (up === down) return undefined;
  const direction: Direction = down ? 'decreasing' : 'increasing';
  let explained = 0;
  for (const [n, ops] of all.entries()) {
    for (let k = 0; k < ops.length; k++) {
      const pair = ops[k].op === 'pop' ? popAgainstNext(tl, ops, k, values) : null;
      if (!pair) continue;
      // a pop that doesn't compare the top with the next element (DFS order, an RPN operand, an undo) breaks the pattern
      if (!evictionRelation(direction, pair.popped, pair.incoming) || !peekedBefore(tl, objIds[n], ops, k)) return undefined;
      explained += 1;
    }
  }
  return explained ? { direction, ...(values && { values }) } : undefined;
}
