/** Hash map / set visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Visualizer } from '../types';
import { describeHashMap } from './describe';
import { detectHashMaps, type HashMapBindings } from './detect';

const HashMapView = lazy(() => import('./HashMapView').then((m) => ({ default: m.HashMapView })));

export const hashMapVisualizer: Visualizer<HashMapBindings> = {
  id: 'hashMap',
  label: 'Hash map / set',
  detect: detectHashMaps,
  Component: HashMapView,
  describe: describeHashMap,
  // a flat grid of cards, seen from a little above
  cameraTilt: 0.3,
};
