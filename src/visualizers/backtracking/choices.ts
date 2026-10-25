/**
 * What each call of a recursive function changes around its recursive calls: the mutations its own frame
 * makes between the previous recursive call returning and the next one starting (the choice), and right
 * after that call returned (the undo). Shared by detection and the per-step model. Pure.
 */
import { keyRepr } from '../../engine/timeline/heap';
import type { HeapChange, Timeline } from '../../engine/timeline/types';
import { sameV, UNDEF } from '../../engine/types/values';
import type { CallTree } from '../shared/callTree';

export interface StepChange {
  step: number;
  h: HeapChange;
}

export interface ChoiceWindow {
  /** the call making the choice */
  parent: number;
  /** the recursive call it makes */
  child: number;
  /** own-frame changes since the previous recursive call returned (or the parent started), up to the call */
  before: StepChange[];
  /** own-frame changes after the call returned, up to the next recursive call (or the parent's end) */
  after: StepChange[];
}

/** The frame whose code made a step's changes: a call step carries the caller's argument evaluation. */
export function ownerCall(tl: Timeline, s: number): number {
  const step = tl.steps[s];
  return step.kind === 'call' ? tl.calls.get(step.callId)?.parentId ?? 0 : step.callId;
}

/** The nearest tree call at or above `callId` (a helper's work belongs to the tree call that invoked it). */
export function treeCallOf(tl: Timeline, tree: CallTree, callId: number): number | null {
  for (let c = tl.calls.get(callId); c; c = tl.calls.get(c.parentId)) if (tree.nodes.has(c.callId)) return c.callId;
  return null;
}

/** First index of a step-sorted list with step ≥ `step`. */
function lowerBound(list: StepChange[], step: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].step < step) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const cache = new WeakMap<CallTree, { steps: number; windows: ChoiceWindow[] }>();

/** One window per recursive call (cached per tree while the timeline keeps its length). */
export function choiceWindows(tl: Timeline, tree: CallTree): ChoiceWindow[] {
  const hit = cache.get(tree);
  if (hit && hit.steps === tl.steps.length) return hit.windows;
  const own = new Map<number, StepChange[]>();
  for (let s = 0; s < tl.diffs.length; s++) {
    const heap = tl.diffs[s].heap;
    if (!heap.length) continue;
    const owner = ownerCall(tl, s);
    if (!tree.nodes.has(owner)) continue;
    let list = own.get(owner);
    if (!list) own.set(owner, (list = []));
    for (const h of heap) if (h.op !== 'alloc') list.push({ step: s, h });
  }
  const range = (list: StepChange[], from: number, to: number) => list.slice(lowerBound(list, from), lowerBound(list, to));
  const windows: ChoiceWindow[] = [];
  for (const node of tree.nodes.values()) {
    const list = own.get(node.callId) ?? [];
    node.children.forEach((child, k) => {
      const c = tree.nodes.get(child)!;
      const prev = k === 0 ? node.enterStep : tree.nodes.get(node.children[k - 1])!.exitStep ?? Infinity;
      const next = k + 1 < node.children.length ? tree.nodes.get(node.children[k + 1])!.enterStep : Infinity;
      windows.push({ parent: node.callId, child, before: range(list, prev, c.enterStep + 1), after: range(list, c.exitStep ?? Infinity, next) });
    });
  }
  cache.set(tree, { steps: tl.steps.length, windows });
  return windows;
}

export const shrinks = (h: HeapChange) =>
  h.op === 'pop' || (h.op === 'splice' && Boolean(h.removed?.length)) || (h.op === 'length' && typeof h.old === 'number' && (h.length ?? 0) < h.old);

/** The push onto `objId` before the call whose element is still there when the call starts. */
export function pendingPush(w: ChoiceWindow, objId: number): StepChange | null {
  let pending: StepChange | null = null;
  for (const c of w.before) {
    if (c.h.id !== objId) continue;
    if (c.h.op === 'push') pending = c;
    else if (shrinks(c.h)) pending = null;
  }
  return pending;
}

/** The entry a write targets: `id:index`, `id:prop` or `id#key` (Map / Set). */
export function slotOf(h: HeapChange): string | null {
  switch (h.op) {
    case 'set':
    case 'delete':
      return h.path.length === 1 ? `${h.id}:${String(h.path[0])}` : null;
    case 'setAdd':
    case 'setDelete':
    case 'mapSet':
    case 'mapDelete':
      return `${h.id}#${keyRepr(h.key)}`;
    default:
      return null;
  }
}

/** A write that changes an entry (writing the value it already holds chooses nothing). */
function chooses(h: HeapChange): boolean {
  if (h.op === 'set' || h.op === 'mapSet') return !(h.old !== undefined && sameV(h.old, h.value));
  return h.op === 'setAdd';
}

/** `undo` puts back what `choose` replaced (`old` is absent when the entry did not exist). */
function undoes(choose: HeapChange, undo: HeapChange): boolean {
  switch (choose.op) {
    case 'set':
      return undo.op === 'set' ? sameV(undo.value, choose.old ?? UNDEF) : undo.op === 'delete' && choose.old === undefined;
    case 'mapSet':
      return undo.op === 'mapSet' ? choose.old !== undefined && sameV(undo.value, choose.old) : undo.op === 'mapDelete' && choose.old === undefined;
    case 'setAdd':
      return undo.op === 'setDelete';
    default:
      return false;
  }
}

export interface Reverted {
  choose: StepChange;
  undo: StepChange;
}

/** Entries changed before the call and put back after it returned (`used[i] = true … used[i] = false`). */
export function revertedWrites(w: ChoiceWindow): Reverted[] {
  const last = new Map<string, StepChange>();
  for (const c of w.before) {
    const slot = slotOf(c.h);
    if (slot === null) continue;
    if (chooses(c.h)) last.set(slot, c);
    else if (c.h.op === 'delete' || c.h.op === 'setDelete' || c.h.op === 'mapDelete') last.delete(slot);
  }
  const out: Reverted[] = [];
  for (const [slot, choose] of last) {
    const undo = w.after.find((c) => slotOf(c.h) === slot && undoes(choose.h, c.h));
    if (undo) out.push({ choose, undo });
  }
  return out;
}
