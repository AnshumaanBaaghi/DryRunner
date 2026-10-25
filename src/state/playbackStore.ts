/** Current step + all step controls (instant: they search the recorded timeline). */
import { create } from 'zustand';
import {
  nextBreakpoint, nextIteration, runToLine, stepInto, stepOut, stepOver, type BreakpointSpec,
} from '../engine/timeline/navigation';
import type { Timeline } from '../engine/timeline/types';
import { evaluateWatch } from '../engine/watch/evaluate';
import { useEditor } from './editorStore';
import { useRun } from './runStore';

export type Direction = 'forward' | 'backward' | 'jump';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const BASE_STEP_MS = 650;

interface PlaybackState {
  step: number;
  prev: number;
  direction: Direction;
  playing: boolean;
  speed: number;
  /** set while dragging the scrubber: animations should snap */
  scrubbing: boolean;
  goto(i: number, direction?: Direction): void;
  forward(): void;
  back(): void;
  over(): void;
  into(): void;
  out(): void;
  nextIter(): void;
  toStart(): void;
  toEnd(): void;
  runToLine(line: number): boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  setSpeed(speed: number): void;
  setScrubbing(on: boolean): void;
  reset(): void;
}

const tl = (): Timeline | null => useRun.getState().timeline;
let timer: ReturnType<typeof setTimeout> | null = null;

function breakpointSpecs(): BreakpointSpec[] {
  return useEditor.getState().breakpoints.map((b) => ({ line: b.line, condition: b.condition }));
}

function conditionHolds(timeline: Timeline) {
  return (expr: string, before: number, callId: number) => {
    const r = evaluateWatch(timeline, Math.max(0, before), expr, callId);
    return r.ok && Boolean(r.value);
  };
}

export const usePlayback = create<PlaybackState>((set, get) => {
  const move = (target: number | null | undefined) => {
    const t = tl();
    if (!t || target === null || target === undefined) return;
    const cur = get().step;
    const next = Math.max(0, Math.min(target, t.steps.length - 1));
    if (next === cur) return;
    const direction: Direction = next === cur + 1 ? 'forward' : next === cur - 1 ? 'backward' : 'jump';
    set({ prev: cur, step: next, direction });
  };

  const scheduleTick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, BASE_STEP_MS / get().speed);
  };

  const tick = () => {
    timer = null;
    const t = tl();
    if (!get().playing || !t) return;
    const cur = get().step;
    const lastIndex = t.steps.length - 1;
    if (cur >= lastIndex) {
      // still streaming: wait for more steps; otherwise stop at the end
      if (useRun.getState().status === 'running') scheduleTick();
      else set({ playing: false });
      return;
    }
    const bp = nextBreakpoint(t, cur, breakpointSpecs(), conditionHolds(t));
    if (bp === cur + 1) {
      move(bp);
      set({ playing: false });
      return;
    }
    move(cur + 1);
    scheduleTick();
  };

  return {
    step: 0,
    prev: 0,
    direction: 'jump',
    playing: false,
    speed: 1,
    scrubbing: false,
    goto(i, direction) {
      const t = tl();
      if (!t) return;
      const next = Math.max(0, Math.min(i, t.steps.length - 1));
      const cur = get().step;
      if (next === cur) return;
      set({ prev: cur, step: next, direction: direction ?? (next === cur + 1 ? 'forward' : next === cur - 1 ? 'backward' : 'jump') });
    },
    forward: () => move(get().step + 1),
    back: () => move(get().step - 1),
    over() {
      const t = tl();
      if (t) move(stepOver(t, get().step));
    },
    into() {
      const t = tl();
      if (t) move(stepInto(t, get().step));
    },
    out() {
      const t = tl();
      if (t) move(stepOut(t, get().step));
    },
    nextIter() {
      const t = tl();
      if (t) move(nextIteration(t, get().step));
    },
    toStart: () => move(0),
    toEnd() {
      const t = tl();
      if (t) move(t.steps.length - 1);
    },
    runToLine(line) {
      const t = tl();
      if (!t) return false;
      const j = runToLine(t, get().step, line);
      if (j === null) return false;
      move(j);
      return true;
    },
    play() {
      const t = tl();
      if (!t || get().playing) return;
      if (get().step >= t.steps.length - 1 && useRun.getState().status !== 'running') move(0);
      set({ playing: true });
      scheduleTick();
    },
    pause() {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ playing: false });
    },
    toggle() {
      if (get().playing) get().pause();
      else get().play();
    },
    setSpeed(speed) {
      set({ speed: Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed)) });
    },
    setScrubbing(on) {
      set({ scrubbing: on });
    },
    reset() {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ step: 0, prev: 0, direction: 'jump', playing: false });
    },
  };
});
