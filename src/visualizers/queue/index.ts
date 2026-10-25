/** Queue visualizer: FIFO queues, deques and priority queues on a conveyor (detection, HUD lines, lazy 3D view). */
import { lazy } from 'react';
import { boundClaims, boundKey, heldObjects } from '../bind';
import type { Visualizer } from '../types';
import { describeQueue } from './describe';
import { detectQueues, type QueueBindings } from './detect';

const QueueView = lazy(() => import('./QueueView').then((m) => ({ default: m.QueueView })));

export const queueVisualizer: Visualizer<QueueBindings> = {
  id: 'queue',
  label: 'Queue',
  detect: detectQueues,
  Component: QueueView,
  describe: describeQueue,
  // looking down onto the conveyor
  cameraTilt: 0.35,
  bindTo(ctx, ref) {
    const objs = heldObjects(ctx, ref, ['array']);
    if (!objs.length) return null;
    return {
      vizId: 'queue', key: boundKey('queue', ref), title: ref.name, score: 1, role: 'primary', mode: 'fifo',
      claims: boundClaims(ref, objs), bindings: { target: ref, objId: objs[0].id, mode: 'fifo' },
    };
  },
};
