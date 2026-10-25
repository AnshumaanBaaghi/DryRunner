/** Graph visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Visualizer } from '../types';
import { describeGraph } from './describe';
import { detectGraphs, type GraphBindings } from './detect';

const GraphView = lazy(() => import('./GraphView').then((m) => ({ default: m.GraphView })));

export const graphVisualizer: Visualizer<GraphBindings> = {
  id: 'graph',
  label: 'Graph',
  detect: detectGraphs,
  Component: GraphView,
  describe: describeGraph,
  // seen a little from above, so nodes behind the front ones stay in view
  cameraTilt: 0.3,
};
