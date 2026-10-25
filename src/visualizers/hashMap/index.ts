/** Hash map / set visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import { boundClaims, boundKey, heldObjects } from '../bind';
import type { Visualizer } from '../types';
import { describeHashMap } from './describe';
import { detectHashMaps, hashKindOf, type HashMapBindings } from './detect';

const HashMapView = lazy(() => import('./HashMapView').then((m) => ({ default: m.HashMapView })));

export const hashMapVisualizer: Visualizer<HashMapBindings> = {
  id: 'hashMap',
  label: 'Hash map / set',
  detect: detectHashMaps,
  Component: HashMapView,
  describe: describeHashMap,
  // a flat grid of cards, seen from a little above
  cameraTilt: 0.3,
  bindTo(ctx, ref) {
    const objs = heldObjects(ctx, ref, ['map', 'set', 'object']).filter((o) => hashKindOf(o.kind, o.cls) !== null);
    const kind = objs[0] && hashKindOf(objs[0].kind, objs[0].cls);
    if (!kind) return null;
    return {
      vizId: 'hashMap', key: boundKey('hashMap', ref), title: ref.name, score: 1, role: 'aux', side: 'left',
      claims: boundClaims(ref, objs), bindings: { target: ref, objId: objs[0].id, kind },
    };
  },
};
