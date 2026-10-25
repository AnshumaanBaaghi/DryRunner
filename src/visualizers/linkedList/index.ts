/** Linked-list visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Visualizer } from '../types';
import { describeList } from './describe';
import { detectLinkedLists, type LinkedListBindings } from './detect';

const LinkedListView = lazy(() => import('./LinkedListView').then((m) => ({ default: m.LinkedListView })));

export const linkedListVisualizer: Visualizer<LinkedListBindings> = {
  id: 'linkedList',
  label: 'Linked list',
  detect: detectLinkedLists,
  Component: LinkedListView,
  describe: describeList,
  // a row seen slightly from above, so the arcs over and under it read apart
  cameraTilt: 0.25,
};
