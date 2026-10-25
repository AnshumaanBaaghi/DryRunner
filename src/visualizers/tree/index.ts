/** Tree visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Visualizer } from '../types';
import { describeTree } from './describe';
import { detectTrees, type TreeBindings } from './detect';

const TreeView = lazy(() => import('./TreeView').then((m) => ({ default: m.TreeView })));

export const treeVisualizer: Visualizer<TreeBindings> = {
  id: 'tree',
  label: 'Tree',
  detect: detectTrees,
  Component: TreeView,
  describe: describeTree,
  // nearly level: an upright tree reads best from the front
  cameraTilt: 0.16,
};
