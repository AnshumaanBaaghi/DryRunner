/**
 * HUD lines of a grid-graph step: a component counted, the cells probed (or stepped onto off the grid), the cells
 * marked and — a backtracking DFS — the cells it backs out of.
 */
import { valueAt } from '../../engine/detect/track';
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { deref, primitive } from '../../engine/timeline/values';
import { cellKey, cellText } from '../dp1d/table';
import type { Detection } from '../types';
import { kindOf, type Cell } from './cells';
import type { GridGraphBindings } from './detect';
import { gridFacts, markedAt, probesAt, type GridFacts } from './facts';
import type { MarkVerb } from './marks';

const DONE: Record<MarkVerb, string> = { sink: 'sunk', fill: 'filled', visit: 'visited' };

/** What a probe finds: a cell visited earlier (a backtracking DFS: one on its path), else what its value reads as on the map. */
function found(tl: Timeline, snap: Snapshot, b: GridGraphBindings, f: GridFacts, cell: Cell, i: number): string {
  const mark = f.byCell.get(cellKey(cell));
  if (mark && mark.step < i) {
    if (!b.backtrack) return DONE[mark.verb];
    if (markedAt(f, cell, i)) return 'on the path';
  }
  const v = deref(snap, snap.heap.get(b.objId)?.elems?.get(cell.r))?.elems?.get(cell.c);
  const kind = kindOf(v, f.open);
  return kind === 'other' ? cellText(tl, snap, v) || 'empty' : kind;
}

export function describeGridGraph(tl: Timeline, i: number, d: Detection<GridGraphBindings>): string[] {
  const b = d.bindings;
  if (i === 0 || !tl.diffs[i]) return [];
  const f = gridFacts(tl, b);
  if (!f.live[i]) return [];
  const snap = tl.snapshots[i];
  const out: string[] = [];
  if (b.counter && f.incs.has(i)) {
    const p = primitive(tl, valueAt(tl, b.counter, i));
    out.push(`new island #${typeof p.value === 'number' ? p.value : [...f.incs].filter((s) => s <= i).length}`);
  }
  for (const p of probesAt(tl, b, f, i)) out.push(`probe (${p.r},${p.c}): ${p.inside ? found(tl, snap, b, f, p, i) : 'off the grid'}`);
  for (const m of f.byStep.get(i) ?? []) out.push(`${m.verb} (${m.r},${m.c})`);
  for (const c of f.unmarkedAt.get(i) ?? []) out.push(`back out of (${c.r},${c.c})`);
  return out;
}
