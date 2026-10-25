/**
 * 1D DP tables: a flat array filled cell by cell in loop order, each cell written at most twice, where
 * writes read other cells of the same array (`dp[i] = dp[i - 1] + dp[i - 2]`) — never ones filled later.
 * Arrays that are rows of a 2D table while being written are left to dp2d.
 */
import { varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import type { ObjId } from '../../engine/types/values';
import type { DetectContext, Detection } from '../types';
import {
  cached, collectWriteSteps, fillStats, indexVars, isDpFill, rowsAt, stepFn, tableVar, trackingVar, varsOf, type Cache, type WriteStep,
} from './table';

export interface Dp1dBindings {
  table: VarRef;
  objId: ObjId;
  /** the integer variable driving the writes (`dp[i] = …`) */
  index?: VarRef;
}

export const DP1D_SCORE = 0.9;
const MIN_CELLS = 3;

const stepsCache: Cache<WriteStep[]> = new WeakMap();

/** Every step writing the flat array `objId` (cells in row 0, column = index). */
export function writeSteps1d(tl: Timeline, objId: ObjId): WriteStep[] {
  const rows = new Map([[objId, 0]]);
  return cached(stepsCache, tl, String(objId), () => collectWriteSteps(tl, () => rows));
}

export function detectDp1d(ctx: DetectContext): Detection<Dp1dBindings>[] {
  const { tl, analysis: a } = ctx;
  const outers = [...a.objects.values()].filter((o) => o.nested && o.kind === 'array').map((o) => o.id);
  const isRow = (id: ObjId, s: number) => outers.some((o) => rowsAt(tl, o, s).has(id));
  const out: Detection<Dp1dBindings>[] = [];
  for (const o of a.objects.values()) {
    if ((o.kind !== 'array' && o.kind !== 'typed') || o.nested || (o.ops.set ?? 0) < MIN_CELLS) continue;
    const steps = writeSteps1d(tl, o.id);
    if (steps.some((s) => isRow(o.id, s.step)) || !isDpFill(fillStats(steps), MIN_CELLS)) continue;
    const fnIds = new Set(steps.map((s) => stepFn(tl, s.step)));
    const table = tableVar(a, o.id, fnIds);
    if (!table) continue;
    const index = trackingVar(tl, indexVars(tl, a, o.id, fnIds), steps, 'c');
    out.push({
      vizId: 'dp1d',
      key: `dp1d:obj:${o.id}`,
      title: table.name,
      score: DP1D_SCORE,
      role: 'primary',
      claims: [...new Set([`obj:${o.id}`, ...varsOf(a, o.id).map((v) => varKey(v.ref))])],
      bindings: { table, objId: o.id, ...(index && { index }) },
    });
  }
  return out;
}
