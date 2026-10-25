/** Derived, memoized views of (timeline, current step) shared by panels. */
import { useMemo, useSyncExternalStore } from 'react';
import { describeStep, loopStatus, type LoopStatus, type StepDescription } from '../engine/describe/narrate';
import type { Snapshot, StepDiff, StepRecord, Timeline } from '../engine/timeline/types';
import { usePlayback } from './playbackStore';
import { useRun } from './runStore';

export interface StepView {
  tl: Timeline;
  i: number;
  last: number;
  step: StepRecord;
  snap: Snapshot;
  diff: StepDiff;
  version: number;
}

export function useStepView(): StepView | null {
  const timeline = useRun((s) => s.timeline);
  const version = useRun((s) => s.version);
  const step = usePlayback((s) => s.step);
  return useMemo(() => {
    if (!timeline || timeline.steps.length === 0) return null;
    const i = Math.min(step, timeline.steps.length - 1);
    return {
      tl: timeline, i, last: timeline.steps.length - 1, step: timeline.steps[i], snap: timeline.snapshots[i],
      diff: timeline.diffs[i], version,
    };
    // version is a dependency on purpose: the timeline grows in place while streaming
  }, [timeline, version, step]);
}

export function useDescription(view: StepView | null): StepDescription | null {
  return useMemo(() => (view ? describeStep(view.tl, view.i) : null), [view]);
}

export function useLoopStatus(view: StepView | null): LoopStatus[] {
  return useMemo(() => (view ? loopStatus(view.tl, view.i) : []), [view]);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
