/** Pure per-step model of the call stack (testable without WebGL): drawn frames, frames leaving this step, the cap. */
import { callLabel } from '../../engine/describe/narrate';
import { visibleVars } from '../../engine/timeline/scope';
import type { StepDiff, Timeline } from '../../engine/timeline/types';
import { previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { userFrames } from './detect';

/** frames drawn at most (the ones further down are counted, not drawn) */
export const MAX_FRAMES = 12;
export const MAX_LOCALS = 4;

export type FrameState = 'active' | 'waiting' | 'returning' | 'threw';

export interface FrameModel {
  callId: number;
  /** `fib(3)` */
  label: string;
  /** up to MAX_LOCALS `name = value` entries in declaration order (functions skipped) */
  locals: string[];
  state: FrameState;
  /** the value being returned (state 'returning') */
  returnText?: string;
  /** entering at this step: pushed (stepping back: popped by the undone step) */
  isNew: boolean;
  /** locals that changed at this step (none for entering frames) */
  changedLocals: string[];
  /** position from the bottom of the drawn stack */
  slot: number;
}

export interface StackModel {
  /** bottom → top: the current frame is last */
  frames: FrameModel[];
  /** frames disappearing at this step, as they were: popped (stepping back: pushed by the undone step) */
  leaving: FrameModel[];
  /** user frames below the drawn ones */
  hiddenBelow: number;
}

const short = (tl: Timeline, i: number, v: V | undefined) => previewValue(tl, tl.snapshots[i], v, { depth: 0, maxString: 10 });

/** The step raises an error: an error step or a `throw` statement. */
function raises(tl: Timeline, i: number): boolean {
  const s = tl.steps[i];
  return s.kind === 'error' || (s.kind === 'stmt' && tl.meta.stmts[s.sid]?.kind === 'throw');
}

function changedIn(tl: Timeline, diff: StepDiff | undefined, callId: number): string[] {
  const names = new Set<string>();
  for (const c of diff?.vars ?? []) if (c.callId === callId && c.kind !== 'same') names.add(tl.meta.bindings[c.bid]?.name ?? '?');
  return [...names];
}

/** Drawn frames of step i (the top MAX_FRAMES) as models; `entering` / `diff` mark new frames and changed locals. */
function stackAt(tl: Timeline, i: number, entering: ReadonlySet<number>, diff: StepDiff | undefined): StackModel {
  const all = userFrames(tl, tl.snapshots[i]);
  const hiddenBelow = Math.max(0, all.length - MAX_FRAMES);
  const drawn = all.slice(hiddenBelow);
  const top = drawn[drawn.length - 1];
  // a step runs in the stack's top frame: an error raised there (or in a callback it runs) is the top user frame's
  const thrower = raises(tl, i) ? top?.callId : undefined;
  const frames = drawn.map((f, slot): FrameModel => {
    const state: FrameState = f.status === 'threw' || f.callId === thrower ? 'threw'
      : f.status === 'returning' ? 'returning' : f === top ? 'active' : 'waiting';
    const isNew = entering.has(f.callId);
    return {
      callId: f.callId,
      label: callLabel(tl, tl.snapshots[i], f.callId),
      locals: visibleVars(tl, f).slice(0, MAX_LOCALS).map((v) => `${v.name} = ${short(tl, i, v.slot.v)}`),
      state,
      ...(state === 'returning' ? { returnText: short(tl, i, f.returning) } : {}),
      isNew,
      changedLocals: isNew ? [] : changedIn(tl, diff, f.callId),
      slot,
    };
  });
  return { frames, leaving: [], hiddenBelow };
}

const NONE: ReadonlySet<number> = new Set();

export function buildStackModel(tl: Timeline, i: number, hl: Highlight | null): StackModel {
  if (!hl) return stackAt(tl, i, NONE, undefined);
  const entering = new Set(hl.reversed ? hl.diff.popped : hl.diff.pushed);
  const model = stackAt(tl, i, entering, hl.diff);
  const gone = new Set(hl.reversed ? hl.diff.pushed : hl.diff.popped);
  const j = hl.reversed ? i + 1 : i - 1;
  if (!gone.size || j < 0 || j >= tl.steps.length) return model;
  const here = new Set(model.frames.map((f) => f.callId));
  // drawn where they were one step away; a frame popped now shows how it ended
  const leaving = stackAt(tl, j, NONE, undefined).frames
    .filter((f) => gone.has(f.callId) && !here.has(f.callId))
    .map((f) => (!hl.reversed && tl.calls.get(f.callId)?.threw ? { ...f, state: 'threw' as const, returnText: undefined } : f));
  return { ...model, leaving };
}

/** `text` cut to `max` characters, ending in "…" when cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return max <= 1 ? '…' : `${text.slice(0, max - 1)}…`;
}

export interface LineSegment {
  text: string;
  /** start column (monospace cells) */
  at: number;
  changed: boolean;
}

const nameOf = (local: string) => local.slice(0, local.indexOf(' = '));

/** The locals that fit a line of `cells` monospace characters, as segments; "…" stands for the rest. */
export function localsLine(frame: Pick<FrameModel, 'locals' | 'changedLocals'>, cells: number): LineSegment[] {
  const out: LineSegment[] = [];
  let at = 0;
  for (let k = 0; k < frame.locals.length; k++) {
    const last = k === frame.locals.length - 1;
    const text = last ? frame.locals[k] : `${frame.locals[k]},`;
    const changed = frame.changedLocals.includes(nameOf(frame.locals[k]));
    // an entry with more after it keeps room for " …"
    if (text.length > cells - at - (last ? 0 : 2)) {
      out.push(out.length ? { text: '…', at, changed: false } : { text: clip(frame.locals[k], cells), at: 0, changed });
      break;
    }
    out.push({ text, at, changed });
    at += text.length + 1;
  }
  return out;
}
