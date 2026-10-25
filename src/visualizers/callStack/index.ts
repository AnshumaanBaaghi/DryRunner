import { lazy } from 'react';
import { callLabel } from '../../engine/describe/narrate';
import type { Timeline } from '../../engine/timeline/types';
import type { Visualizer } from '../types';
import { detectCallStack, isUserCall, type CallStackBindings } from './detect';

const CallStackView = lazy(() => import('./CallStackView').then((m) => ({ default: m.CallStackView })));

/** HUD line when an exception unwinds calls (ordinary calls and returns are already narrated). */
function describe(tl: Timeline, i: number): string[] {
  const diff = tl.diffs[i];
  const snap = tl.snapshots[i];
  if (!diff || !snap) return [];
  const unwound = diff.popped.filter((id) => isUserCall(tl, id) && tl.calls.get(id)?.threw);
  if (!unwound.length) return [];
  const names = unwound.slice(0, 3).map((id) => callLabel(tl, snap, id));
  return [`exception unwound ${names.join(', ')}${unwound.length > 3 ? ` and ${unwound.length - 3} more` : ''}`];
}

export const callStackVisualizer: Visualizer<CallStackBindings> = {
  id: 'callStack',
  label: 'Call stack',
  detect: detectCallStack,
  Component: CallStackView,
  describe,
};
