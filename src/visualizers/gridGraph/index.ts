/** Grid graph visualizer (islands, flood fill, mazes): detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Visualizer } from '../types';
import { describeGridGraph } from './describe';
import { detectGridGraph, type GridGraphBindings } from './detect';

const GridGraphView = lazy(() => import('./GridGraphView').then((m) => ({ default: m.GridGraphView })));

export const gridGraphVisualizer: Visualizer<GridGraphBindings> = {
  id: 'gridGraph',
  label: 'Grid graph',
  detect: detectGridGraph,
  Component: GridGraphView,
  describe: describeGridGraph,
  // a board seen a little from above, so raised (visited) tiles read as relief
  cameraTilt: 0.25,
};
