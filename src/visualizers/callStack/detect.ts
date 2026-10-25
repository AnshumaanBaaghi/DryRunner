/**
 * Call stack: shown when user functions nest (recursion, helpers calling helpers). The top level and
 * callbacks the runtime drives (array-method callbacks, `Array.from(…, () => …)` initializers) don't
 * count as frames: they are bookkeeping, not calls the user made.
 */
import type { FrameSnap, Snapshot, Timeline } from '../../engine/timeline/types';
import type { DetectContext, Detection } from '../types';

export type CallStackBindings = Record<string, never>;

/** Callbacks: flagged by the instrumenter, or anonymous functions passed as an argument (named `callback`). */
export function isCallbackFn(tl: Timeline, fnId: number): boolean {
  const fn = tl.meta.fns[fnId];
  return Boolean(fn && (fn.isCallback || fn.name === 'callback'));
}

export function isUserCall(tl: Timeline, callId: number): boolean {
  const call = tl.calls.get(callId);
  return callId !== 0 && call !== undefined && !isCallbackFn(tl, call.fnId);
}

/** Frames of user calls on the stack, bottom → top. */
export function userFrames(tl: Timeline, snap: Snapshot): FrameSnap[] {
  const out: FrameSnap[] = [];
  for (const f of snap.frames) if (f.callId !== 0 && !isCallbackFn(tl, f.fnId)) out.push(f);
  return out;
}

const depthCache = new WeakMap<Timeline, { calls: number; max: number }>();

/** Deepest nesting of user calls in the trace (the stack at a call's entry is its chain of callers). */
export function maxStackDepth(tl: Timeline): number {
  const hit = depthCache.get(tl);
  if (hit && hit.calls === tl.calls.size) return hit.max;
  const depth = new Map<number, number>();
  let max = 0;
  // calls are recorded in entry order, so a caller is always seen before its callees
  for (const call of tl.calls.values()) {
    const d = (depth.get(call.parentId) ?? 0) + (isCallbackFn(tl, call.fnId) ? 0 : 1);
    depth.set(call.callId, d);
    max = Math.max(max, d);
  }
  depthCache.set(tl, { calls: tl.calls.size, max });
  return max;
}

export function detectCallStack({ tl }: DetectContext): Detection<CallStackBindings>[] {
  if (maxStackDepth(tl) < 2) return [];
  return [{ vizId: 'callStack', key: 'callStack', title: 'call stack', score: 0.5, role: 'aux', side: 'right', bindings: {}, claims: [] }];
}
