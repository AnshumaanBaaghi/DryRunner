import { lazy } from 'react';
import { valueAt } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import type { Detection, Visualizer } from '../types';
import { detectArrays, type ArrayBindings } from './detect';

const ArrayView = lazy(() => import('./ArrayView').then((m) => ({ default: m.ArrayView })));

function num(tl: Timeline, ref: ArrayBindings['pointers'][number]['ref'], i: number): number | null {
  const v = valueAt(tl, ref, i);
  return typeof v === 'number' ? v : null;
}

/** HUD lines: how the window / search interval moved at this step. */
function describe(tl: Timeline, i: number, d: Detection<ArrayBindings>): string[] {
  if (i === 0) return [];
  const out: string[] = [];
  const b = d.bindings;
  const edge = (ref: ArrayBindings['pointers'][number]['ref'], grow: 1 | -1, verbs: [string, string]) => {
    const now = num(tl, ref, i);
    const before = num(tl, ref, i - 1);
    if (now === null || before === null || now === before) return;
    out.push(`${(now - before) * grow > 0 ? verbs[0] : verbs[1]}: ${ref.name} → ${now}`);
  };
  if (b.window) {
    edge(b.window.right, 1, ['window expanded', 'window shrunk']);
    edge(b.window.left, -1, ['window expanded', 'window shrunk']);
  }
  if (b.interval) {
    edge(b.interval.lo, -1, ['search interval grew', 'search interval narrowed']);
    edge(b.interval.hi, 1, ['search interval grew', 'search interval narrowed']);
  }
  return out;
}

export const arrayVisualizer: Visualizer<ArrayBindings> = {
  id: 'array',
  label: 'Array / pointers',
  detect: detectArrays,
  Component: ArrayView,
  describe,
};
