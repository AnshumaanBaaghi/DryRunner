/** Iteration space of two nested loops: which (outer, inner) iteration pairs have been visited by step i. */
import type { LoopSnap, Timeline } from '../../engine/timeline/types';

export interface IterationSpace {
  rows: number;
  cols: number;
  /** `${outer}:${inner}` → first step reaching that pair */
  firstStep: Map<string, number>;
}

const cache = new WeakMap<Timeline, Map<number, IterationSpace>>();

export function iterationSpace(tl: Timeline, outer: LoopSnap, innerLoopId: number): IterationSpace {
  let byInst = cache.get(tl);
  if (!byInst) {
    byInst = new Map();
    cache.set(tl, byInst);
  }
  const hit = byInst.get(outer.inst);
  if (hit) return hit;
  const inst = tl.loops.get(outer.inst);
  const firstStep = new Map<string, number>();
  let cols = 0;
  const start = inst?.startStep ?? 0;
  const end = inst?.endStep ?? tl.steps.length;
  for (let i = start; i < end && i < tl.steps.length; i++) {
    const loops = tl.steps[i].loops;
    const o = loops.find((l) => l.inst === outer.inst);
    const inn = loops.find((l) => l.loopId === innerLoopId);
    if (!o || !inn || o.iteration < 1 || inn.iteration < 1) continue;
    cols = Math.max(cols, inn.iteration);
    const key = `${o.iteration}:${inn.iteration}`;
    if (!firstStep.has(key)) firstStep.set(key, i);
  }
  const space = { rows: Math.max(1, inst?.iterations ?? 1), cols: Math.max(1, cols), firstStep };
  if (inst?.endStep !== undefined) byInst.set(outer.inst, space);
  return space;
}
