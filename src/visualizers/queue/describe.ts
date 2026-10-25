/** HUD lines for a queue step: `enqueue 4`, `dequeue → 1`, `extract min [1, 2]`, `re-sorted by priority`, `push front 3`. */
import type { Timeline } from '../../engine/timeline/types';
import { deref, previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import type { Detection } from '../types';
import type { QueueBindings } from './detect';
import { knownBy, queueStats, stepOps } from './model';

/** Values as in the variables panel, class instances by the field they are known by (`TreeNode(8)`). */
function itemText(tl: Timeline, i: number, v: V): string {
  const snap = tl.snapshots[i];
  const obj = deref(snap, v);
  const field = obj?.cls ? knownBy(snap, obj) : undefined;
  if (obj?.cls && field !== undefined) return `${obj.cls}(${previewValue(tl, snap, field, { depth: 0, maxString: 12 })})`;
  return previewValue(tl, snap, v, { depth: 1, maxItems: 4, maxString: 12 });
}

export function describeQueue(tl: Timeline, i: number, d: Detection<QueueBindings>): string[] {
  const b = d.bindings;
  const ops = stepOps(tl, i, b).filter((op) => op.kind === 'sort' || op.values.length);
  if (!ops.length) return [];
  const list = (values: V[]) => values.map((v) => itemText(tl, i, v)).join(', ');
  const stats = b.mode === 'priority' ? queueStats(tl, b) : null;
  return ops.map((op) => {
    if (op.kind === 'sort') return b.mode === 'priority' ? 're-sorted by priority' : 'sorted';
    const end = op.side === 'front' ? 'front' : 'back';
    if (b.mode === 'deque') return op.kind === 'add' ? `push ${end} ${list(op.values)}` : `pop ${end} → ${list(op.values)}`;
    if (op.kind === 'add') return `enqueue ${list(op.values)}`;
    if (stats?.ranked) return `extract ${stats.minFirst ? 'min' : 'max'} ${list(op.values)}`;
    return `dequeue → ${list(op.values)}`;
  });
}
