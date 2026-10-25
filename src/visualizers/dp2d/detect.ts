/**
 * 2D DP tables: an array of row arrays filled cell by cell in nested-loop order (row- or column-major),
 * each cell written at most twice, where writes read other cells of the table (`dp[i][j] = dp[i - 1][j - 1]
 * + 1`) — never ones filled later. A written row array maps to its row index through the outer array's
 * elements at that step. Headers: when the row (column) index variable also indexes a string in the same
 * function (`a[i - 1]`) one shorter than the rows (or as long), that string's characters.
 */
import type { List } from 'immutable';
import { resolveVarKey } from '../../engine/detect/analysis';
import { valueAt, varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { primitive } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import {
  cached, collectWriteSteps, fillStats, isDpFill, isIntVar, isStringVar, rowsAt, stepFn, tableVar, trackingVar, varsOf, type Cache,
  type WriteStep,
} from '../dp1d/table';
import type { DetectContext, Detection } from '../types';

/** A string whose characters name the rows (columns); offset -1: row 0 is the empty prefix (`a[i - 1]`). */
export interface HeaderBinding {
  ref: VarRef;
  offset: -1 | 0;
}

export interface Dp2dBindings {
  table: VarRef;
  /** the outer array */
  objId: ObjId;
  /** integer variables following the written cell's row / column */
  row?: VarRef;
  col?: VarRef;
  rowHeader?: HeaderBinding;
  colHeader?: HeaderBinding;
}

export const DP2D_SCORE = 0.95;
const MIN_CELLS = 4;

const stepsCache: Cache<WriteStep[]> = new WeakMap();

/** Every step writing a cell of the 2D table `outer`. */
export function writeSteps2d(tl: Timeline, outer: ObjId): WriteStep[] {
  return cached(stepsCache, tl, String(outer), () => collectWriteSteps(tl, (s) => rowsAt(tl, outer, s)));
}

export interface TableShape {
  /** largest row count / row length in the trace (a stable board) */
  rows: number;
  cols: number;
  /** every array that was a row */
  rowIds: ObjId[];
}

const shapeCache: Cache<TableShape> = new WeakMap();

export function tableShape(tl: Timeline, outer: ObjId): TableShape {
  return cached(shapeCache, tl, String(outer), () => {
    let rows = 0;
    let cols = 0;
    const ids = new Set<ObjId>();
    let last: List<V> | undefined;
    for (let s = 0; s < tl.snapshots.length; s++) {
      const snap = tl.snapshots[s];
      const elems = snap.heap.get(outer)?.elems;
      if (!elems) continue;
      const map = rowsAt(tl, outer, s);
      // a new outer list: every row may be new; otherwise only rows changed in this step can have grown
      const changed = elems !== last ? [...map.keys()] : tl.diffs[s].heap.map((h) => h.id).filter((id) => map.has(id));
      if (elems !== last) rows = Math.max(rows, elems.size);
      last = elems;
      for (const id of changed) {
        ids.add(id);
        cols = Math.max(cols, snap.heap.get(id)?.elems?.size ?? 0);
      }
    }
    return { rows, cols, rowIds: [...ids] };
  });
}

/** Text of a string variable at step i (null when it holds something else). */
export function stringAt(tl: Timeline, ref: VarRef, i: number): string | null {
  const p = primitive(tl, valueAt(tl, ref, i));
  return typeof p.value === 'string' ? p.value : null;
}

/** A string indexed by `idx` in the writing functions whose length fits `n` rows (columns). */
function headerFor(ctx: DetectContext, idx: VarRef, fnIds: ReadonlySet<number>, n: number): HeaderBinding | undefined {
  const { tl, analysis: a } = ctx;
  for (const u of tl.meta.analysis.indexUsage) {
    if (!fnIds.has(u.fnId) || resolveVarKey(a, u.index, u.fnId) !== varKey(idx)) continue;
    const info = a.vars.get(resolveVarKey(a, u.object, u.fnId) ?? '');
    if (!info || !isStringVar(info)) continue;
    const length = stringAt(tl, info.ref, tl.steps.length - 1)?.length;
    if (length === n - 1) return { ref: info.ref, offset: -1 };
    if (length === n) return { ref: info.ref, offset: 0 };
  }
  return undefined;
}

export function detectDp2d(ctx: DetectContext): Detection<Dp2dBindings>[] {
  const { tl, analysis: a } = ctx;
  const out: Detection<Dp2dBindings>[] = [];
  for (const o of a.objects.values()) {
    if (o.kind !== 'array' || !o.nested) continue;
    const steps = writeSteps2d(tl, o.id);
    if (!isDpFill(fillStats(steps), MIN_CELLS)) continue;
    const fnIds = new Set(steps.map((s) => stepFn(tl, s.step)));
    const table = tableVar(a, o.id, fnIds);
    if (!table) continue;
    const ints = [...a.vars.values()].filter((v) => fnIds.has(v.ref.fnId) && isIntVar(v));
    const row = trackingVar(tl, ints, steps, 'r');
    const col = trackingVar(tl, ints.filter((v) => v.ref !== row), steps, 'c');
    const shape = tableShape(tl, o.id);
    const rowHeader = row && headerFor(ctx, row, fnIds, shape.rows);
    const colHeader = col && headerFor(ctx, col, fnIds, shape.cols);
    // the header strings are drawn along the table's edges, so they need no view of their own
    const headers = [rowHeader, colHeader].flatMap((h) => (h ? [varKey(h.ref)] : []));
    const claims = [`obj:${o.id}`, ...shape.rowIds.map((id) => `obj:${id}`), ...varsOf(a, o.id).map((v) => varKey(v.ref)), ...headers];
    out.push({
      vizId: 'dp2d',
      key: `dp2d:obj:${o.id}`,
      title: table.name,
      score: DP2D_SCORE,
      role: 'primary',
      claims: [...new Set(claims)],
      bindings: {
        table, objId: o.id, ...(row && { row }), ...(col && { col }), ...(rowHeader && { rowHeader }), ...(colHeader && { colHeader }),
      },
    });
  }
  return out;
}
