/** Step controls as instant scans over the recorded steps (no re-execution). */
import type { CondEvent } from '../types/trace';
import type { LoopSnap, StepRecord, Timeline } from './types';

const last = (tl: Timeline) => Math.max(0, tl.steps.length - 1);
const clamp = (tl: Timeline, i: number) => Math.min(Math.max(0, i), last(tl));

/** Over: at a call step skip the whole call; elsewhere skip nested calls (next step at depth ≤ d). */
export function stepOver(tl: Timeline, i: number): number {
  const cur = tl.steps[i];
  if (!cur) return clamp(tl, i);
  if (cur.kind === 'call') {
    const exit = tl.calls.get(cur.callId)?.exitStep;
    return exit === undefined ? last(tl) : clamp(tl, exit);
  }
  for (let j = i + 1; j < tl.steps.length; j++) if (tl.steps[j].depth <= cur.depth) return j;
  return last(tl);
}

/** Into: the next call made while the frame's next statement runs; otherwise a plain step. */
export function stepInto(tl: Timeline, i: number): number {
  const cur = tl.steps[i];
  if (!cur) return clamp(tl, i);
  if (cur.kind === 'call') return clamp(tl, i + 1);
  const over = stepOver(tl, i);
  for (let j = i + 1; j < over; j++) if (tl.steps[j].kind === 'call') return j;
  return clamp(tl, i + 1);
}

/** Out: the first step after the current frame exits. */
export function stepOut(tl: Timeline, i: number): number {
  const cur = tl.steps[i];
  if (!cur || cur.callId === 0) return last(tl);
  return clamp(tl, tl.calls.get(cur.callId)?.exitStep ?? last(tl));
}

function isFinalCheck(step: StepRecord, loop: LoopSnap): boolean {
  const ev = step.ev as CondEvent | null;
  return Boolean(ev && ev.t === 'cond' && ev.loop?.inst === loop.inst && !ev.result);
}

function loopsAt(tl: Timeline, i: number): LoopSnap[] {
  const step = tl.steps[i];
  if (!step) return [];
  if (step.loops.length) return step.loops;
  // inside a callback (forEach/map…): the iteration loop lives in the caller's frame
  const snap = tl.snapshots[i];
  for (let k = snap.frames.size - 1; k >= 0; k--) {
    const f = snap.frames.get(k);
    if (f && f.loops.size) return f.loops.toArray();
  }
  return [];
}

/** Next iteration of the innermost active loop; from a loop's final check, move to the enclosing loop. */
export function nextIteration(tl: Timeline, i: number): number {
  const loops = loopsAt(tl, i);
  for (let k = loops.length - 1; k >= 0; k--) {
    const loop = loops[k];
    if (isFinalCheck(tl.steps[i], loop)) continue;
    const inst = tl.loops.get(loop.inst);
    if (!inst) continue;
    const next = inst.checkSteps.find((s) => s > i);
    if (next !== undefined) return next;
    if (inst.endStep !== undefined && inst.endStep > i) return clamp(tl, inst.endStep);
  }
  return clamp(tl, i + 1);
}

/** Run to line: the next step that first-touches `line` (a statement instance or a call from it). */
export function runToLine(tl: Timeline, i: number, line: number): number | null {
  for (let j = i + 1; j < tl.steps.length; j++) if (tl.touches[j] === line) return j;
  return null;
}

export interface BreakpointSpec {
  line: number;
  condition?: string;
}

/**
 * Next breakpoint hit after `i`. Conditions are evaluated against the state *before* the step
 * (snapshot j-1) in that statement's frame, like a debugger pausing before the line runs.
 */
export function nextBreakpoint(tl: Timeline, i: number, bps: BreakpointSpec[],
  evalCondition?: (expr: string, stepBefore: number, callId: number) => boolean): number | null {
  if (!bps.length) return null;
  const byLine = new Map<number, BreakpointSpec>();
  for (const bp of bps) byLine.set(bp.line, bp);
  for (let j = i + 1; j < tl.steps.length; j++) {
    const line = tl.touches[j];
    if (!line) continue;
    const bp = byLine.get(line);
    if (!bp) continue;
    if (!bp.condition || !evalCondition) return j;
    const step = tl.steps[j];
    const frameId = step.kind === 'call' && step.ev?.t === 'call' ? step.ev.parentId : step.callId;
    if (evalCondition(bp.condition, j - 1, frameId)) return j;
  }
  return null;
}

/** Steps at which breakpoints fire (timeline markers). */
export function breakpointSteps(tl: Timeline, lines: Set<number>, limit = 2_000): number[] {
  const out: number[] = [];
  for (let j = 1; j < tl.steps.length && out.length < limit; j++) if (lines.has(tl.touches[j])) out.push(j);
  return out;
}
