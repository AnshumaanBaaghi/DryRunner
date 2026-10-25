/**
 * Which bindings of a frame are visible at a step — derived from static scope nesting and per-iteration
 * loop state, so break/continue/return/throw never leave stale block variables behind.
 */
import type { BindingKind } from '../types/meta';
import type { FrameSnap, Snapshot, Timeline, VarSlot } from './types';
import { isFnValue } from './values';

export interface VisibleVar {
  bid: number;
  name: string;
  kind: BindingKind;
  slot: VarSlot;
}

export interface VisibilityOptions {
  includeFunctions?: boolean;
}

export function visibleVars(tl: Timeline, frame: FrameSnap, opts: VisibilityOptions = {}): VisibleVar[] {
  const meta = tl.meta;
  const pos = frame.stmt >= 0 ? (meta.stmts[frame.stmt]?.loc.start ?? -1) : -1;
  const out: VisibleVar[] = [];
  for (const [bid, slot] of frame.vars) {
    const b = meta.bindings[bid];
    if (!b) continue;
    if (!opts.includeFunctions && (b.kind === 'function' || b.kind === 'class' || isFnValue(slot.v))) continue;
    if (b.loopId !== undefined) {
      const loop = frame.loops.findLast((l) => l.loopId === b.loopId);
      if (!loop || loop.inst !== slot.loopInst) continue;
      if (b.loopScope === 'body' && loop.iteration !== slot.iter) continue;
    } else if ((b.kind === 'let' || b.kind === 'const') && pos >= 0 && (pos < b.scopeStart || pos > b.scopeEnd)) {
      continue;
    }
    out.push({ bid, name: b.name, kind: b.kind, slot });
  }
  return out.sort((a, b) => a.slot.ord - b.slot.ord);
}

export function topFrame(snap: Snapshot): FrameSnap {
  return snap.frames.last() as FrameSnap;
}

export function frameById(snap: Snapshot, callId: number): FrameSnap | undefined {
  for (let i = snap.frames.size - 1; i >= 0; i--) {
    const f = snap.frames.get(i) as FrameSnap;
    if (f.callId === callId) return f;
  }
  return snap.detached.get(callId);
}

/** Lexical scope chain for name lookup (watches): frame → lexical parents → globals. */
export function scopeChain(snap: Snapshot, frame: FrameSnap): FrameSnap[] {
  const chain: FrameSnap[] = [frame];
  const seen = new Set<number>([frame.callId]);
  let cur: FrameSnap | undefined = frame;
  while (cur && cur.lexParentId !== null && !seen.has(cur.lexParentId)) {
    seen.add(cur.lexParentId);
    cur = frameById(snap, cur.lexParentId);
    if (cur) chain.push(cur);
  }
  const main = snap.frames.first() as FrameSnap | undefined;
  if (main && !seen.has(main.callId)) chain.push(main);
  return chain;
}
