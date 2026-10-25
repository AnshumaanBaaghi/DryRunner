/**
 * Animation timing tied to playback: springs run faster at higher speeds, snap while scrubbing, and
 * stepping backward highlights what the step we just undid changed (so reversals animate too).
 */
import { easings, type SpringConfig } from '@react-spring/three';
import { useMemo } from 'react';
import type { StepDiff } from '../engine/timeline/types';
import { usePlayback, type Direction } from '../state/playbackStore';
import type { StepView } from '../state/selectors';

const BASE_MS = 520;

export interface AnimTiming {
  config: SpringConfig;
  immediate: boolean;
  direction: Direction;
  /** seconds — for imperative (useFrame) damping */
  smoothTime: number;
}

export function useAnimTiming(): AnimTiming {
  const speed = usePlayback((s) => s.speed);
  const scrubbing = usePlayback((s) => s.scrubbing);
  const direction = usePlayback((s) => s.direction);
  return useMemo(() => {
    const ms = (direction === 'jump' ? BASE_MS * 0.55 : BASE_MS) / Math.max(0.25, speed);
    return {
      config: { duration: Math.max(60, ms), easing: easings.easeInOutCubic },
      immediate: scrubbing,
      direction,
      smoothTime: Math.max(0.03, ms / 1000 / 3),
    };
  }, [speed, scrubbing, direction]);
}

export interface Highlight {
  diff: StepDiff;
  /** true when stepping backward: the diff is the one being undone (show new → old) */
  reversed: boolean;
  /** changes a step identity so pulses replay */
  key: string;
}

/** Changes to emphasize at the current step (forward: this step's; backward: the undone step's). */
export function useHighlight(view: StepView | null): Highlight | null {
  const prev = usePlayback((s) => s.prev);
  const direction = usePlayback((s) => s.direction);
  return useMemo(() => {
    if (!view) return null;
    if (direction === 'backward' && prev === view.i + 1 && view.tl.diffs[prev]) {
      return { diff: view.tl.diffs[prev], reversed: true, key: `b${prev}` };
    }
    return { diff: view.diff, reversed: false, key: `f${view.i}` };
  }, [view, prev, direction]);
}
