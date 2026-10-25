/** 1D DP table visualizer: detection, HUD line and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Timeline } from '../../engine/timeline/types';
import type { Detection, Visualizer } from '../types';
import { detectDp1d, type Dp1dBindings } from './detect';
import { readCells, writtenCell, type Cell } from './table';

const Dp1dView = lazy(() => import('./Dp1dView').then((m) => ({ default: m.Dp1dView })));

/** HUD line: the cell written and the cells it was computed from (`dp[4] ← dp[3], dp[2]`). */
function describe(tl: Timeline, i: number, d: Detection<Dp1dBindings>): string[] {
  const diff = tl.diffs[i];
  if (!diff) return [];
  const rows = new Map([[d.bindings.objId, 0]]);
  const written = diff.heap.map((h) => writtenCell(h, rows)).filter((c): c is Cell => c !== null);
  if (!written.length) return [];
  const at = (c: Cell) => `${d.bindings.table.name}[${c.c}]`;
  const reads = readCells(diff.reads, rows, written);
  return [reads.length ? `${at(written[0])} ← ${reads.map(at).join(', ')}` : `fill ${at(written[0])}`];
}

export const dp1dVisualizer: Visualizer<Dp1dBindings> = {
  id: 'dp1d',
  label: 'DP table (1D)',
  detect: detectDp1d,
  Component: Dp1dView,
  describe,
  cameraTilt: 0.3,
};
