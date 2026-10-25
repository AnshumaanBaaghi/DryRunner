/** Queue visualizer: FIFO queues, deques and priority queues on a conveyor (detection, HUD lines, lazy 3D view). */
import { lazy } from 'react';
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
};
