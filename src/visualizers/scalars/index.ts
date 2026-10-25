import { lazy } from 'react';
import type { Visualizer } from '../types';

const ScalarsView = lazy(() => import('./ScalarsView').then((m) => ({ default: m.ScalarsView })));

/** Always available; becomes the primary stage only when nothing more specific is detected. */
export const scalarsVisualizer: Visualizer<Record<string, never>> = {
  id: 'scalars',
  label: 'Variables & loops',
  detect: ({ tl }) => {
    const nested = tl.meta.loops.some((l) => l.parent !== null && l.kind !== 'callback');
    return [{
      vizId: 'scalars', key: 'scalars', title: 'variables', score: 0.2, role: 'primary', bindings: {}, claims: [],
      mode: nested ? 'iteration-space' : undefined,
    }];
  },
  Component: ScalarsView,
};
