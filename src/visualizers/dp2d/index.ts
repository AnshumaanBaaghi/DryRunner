/** 2D DP table visualizer: detection, HUD line and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Timeline } from '../../engine/timeline/types';
import { readCells, rowsAt, writtenCell, type Cell } from '../dp1d/table';
import type { Detection, Visualizer } from '../types';
import { detectDp2d, type Dp2dBindings } from './detect';

const Dp2dView = lazy(() => import('./Dp2dView').then((m) => ({ default: m.Dp2dView })));

/** HUD line: the cell written and the cells it was computed from (`fill dp[3][4] from dp[2][3], dp[3][3]`). */
function describe(tl: Timeline, i: number, d: Detection<Dp2dBindings>): string[] {
  const diff = tl.diffs[i];
  if (!diff) return [];
  const rows = rowsAt(tl, d.bindings.objId, i);
  const written = diff.heap.map((h) => writtenCell(h, rows)).filter((c): c is Cell => c !== null);
  if (!written.length) return [];
  const at = (c: Cell) => `${d.bindings.table.name}[${c.r}][${c.c}]`;
  const reads = readCells(diff.reads, rows, written);
  return [`fill ${at(written[0])}${reads.length ? ` from ${reads.map(at).join(', ')}` : ''}`];
}

export const dp2dVisualizer: Visualizer<Dp2dBindings> = {
  id: 'dp2d',
  label: 'DP table (2D)',
  detect: detectDp2d,
  Component: Dp2dView,
  describe,
  // an upright board, like the backtracking board
  cameraTilt: 0.16,
};
