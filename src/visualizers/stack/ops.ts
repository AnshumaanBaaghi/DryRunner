/**
 * A stack's operations read off the trace: pushes and pops in order (one entry per element) and top peeks
 * (`s[s.length - 1]`, `s.at(-1)`). A peek may happen before or after the step's own push / pop, so it
 * matches the top of either side of the step.
 */
import type { Timeline } from '../../engine/timeline/types';
import { UNDEF, type ObjId, type V } from '../../engine/types/values';

export interface StackOp {
  step: number;
  op: 'push' | 'pop';
  /** the element pushed or popped */
  value: V;
  /** its index in the array */
  index: number;
}

const cache = new WeakMap<Timeline, Map<ObjId, { n: number; ops: StackOp[] }>>();

/** Pushes and pops of array `objId` in trace order (`push(a, b)` counts as two). */
export function stackOps(tl: Timeline, objId: ObjId): StackOp[] {
  let byObj = cache.get(tl);
  if (!byObj) {
    byObj = new Map();
    cache.set(tl, byObj);
  }
  const hit = byObj.get(objId);
  if (hit && hit.n === tl.diffs.length) return hit.ops;
  const ops: StackOp[] = [];
  for (let step = 0; step < tl.diffs.length; step++) {
    for (const h of tl.diffs[step].heap) {
      if (h.id !== objId) continue;
      const at = typeof h.path[0] === 'number' ? h.path[0] : 0;
      if (h.op === 'push') (h.args ?? []).forEach((value, k) => ops.push({ step, op: 'push', value, index: at + k }));
      else if (h.op === 'pop') ops.push({ step, op: 'pop', value: h.old ?? UNDEF, index: at });
    }
  }
  byObj.set(objId, { n: tl.diffs.length, ops });
  return ops;
}

/** Elements of array `objId` after step i (0 when it doesn't exist). */
const lengthAt = (tl: Timeline, objId: ObjId, i: number): number => tl.snapshots[i]?.heap.get(objId)?.elems?.size ?? 0;

/** The top element read at step i (its index and value), or null. */
export function peekAt(tl: Timeline, objId: ObjId, i: number): { index: number; value: V } | null {
  const reads = tl.diffs[i]?.reads ?? [];
  if (!reads.some((r) => r.id === objId)) return null;
  const tops = [lengthAt(tl, objId, i) - 1, i > 0 ? lengthAt(tl, objId, i - 1) - 1 : -1];
  for (const r of reads) {
    const at = r.path[0];
    if (r.id === objId && typeof at === 'number' && at >= 0 && tops.includes(at)) return { index: at, value: r.value };
  }
  return null;
}

/** The next push after the `k`-th op (the element a pop made room for), or null. */
export function nextPush(ops: StackOp[], k: number): StackOp | null {
  for (let n = k + 1; n < ops.length; n++) if (ops[n].op === 'push') return ops[n];
  return null;
}
