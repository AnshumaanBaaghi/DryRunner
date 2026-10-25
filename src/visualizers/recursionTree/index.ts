import { lazy } from 'react';
import { previewValue } from '../../engine/timeline/values';
import type { Timeline } from '../../engine/timeline/types';
import { buildCallTree } from '../shared/callTree';
import type { Detection, Visualizer } from '../types';
import { detectRecursion, type RecursionBindings } from './detect';
import { dcArrays } from './model';

const RecursionTreeView = lazy(() => import('./RecursionTreeView').then((m) => ({ default: m.RecursionTreeView })));

/** HUD lines: how deep the recursion is and, for divide and conquer, what a finished call produced. */
function describe(tl: Timeline, i: number, d: Detection<RecursionBindings>): string[] {
  const step = tl.steps[i];
  const tree = buildCallTree(tl, d.bindings.fnIds);
  const node = tree.nodes.get(step?.callId ?? -1);
  if (!step || !node) return [];
  if (step.kind === 'call') {
    const made = [...tree.nodes.values()].filter((n) => n.enterStep <= i).length;
    const maxDepth = Math.max(...[...tree.nodes.values()].map((n) => n.depth));
    return [`recursion depth ${node.depth} of ${maxDepth} · call ${made} of ${tree.nodes.size}`];
  }
  if (step.kind === 'return' && d.bindings.dc) {
    const { input, output } = dcArrays(tl, node);
    const fmt = (xs: typeof input) => (xs ? `[${xs.map((v) => previewValue(tl, tl.snapshots[i], v, { depth: 0 })).join(', ')}]` : '…');
    if (input && output) return [`sub-problem ${fmt(input)} solved → ${fmt(output)}`];
  }
  return [];
}

export const recursionTreeVisualizer: Visualizer<RecursionBindings> = {
  id: 'recursionTree',
  label: 'Recursion tree',
  detect: detectRecursion,
  Component: RecursionTreeView,
  describe,
  cameraTilt: 0.16,
};
