/**
 * Pure per-step model of the linked-list view (testable without WebGL): each node's value and links, the
 * links written this step (old target → new target), the nodes created, where the pointer variables are,
 * and the run-wide frame (stable slots, widest arcs, tallest marker stack) that keeps the drawing still.
 */
import { varKey, type VarRef } from '../../engine/detect/track';
import { isVisible } from '../../engine/timeline/scope';
import type { FrameSnap, Snapshot, Timeline, VarSlot } from '../../engine/timeline/types';
import { previewValue, refId } from '../../engine/timeline/values';
import { isUndef, type ObjId, type V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import type { LinkedListBindings } from './detect';
import { linkPairs, stableOrder } from './links';

/** nodes drawn one by one; the rest share a "+N more" slot */
export const MAX_SLOTS = 48;

/** where a link ends: a slot, null (a null / undefined value) or undefined (no such property, or not a node) */
export type Target = number | null | undefined;

export interface PointerTrack {
  /** the node held at each step: an id, null, or undefined (no running call holds it, or not a node) */
  at: (ObjId | null | undefined)[];
  /** step since which `at` has held its current value */
  since: number[];
}

export interface ListFrame {
  /** node id → slot (nodes past MAX_SLOTS share the overflow slot) */
  slotOf: Map<ObjId, number>;
  /** nodes sharing the overflow slot */
  hidden: number;
  /** where pointers holding null point (past the end); -1 when none ever does */
  nullSlot: number;
  slotCount: number;
  /** widest link pointing right / left, in slots (0: none) */
  spanRight: number;
  spanLeft: number;
  /** most pointer markers sharing a slot at any step */
  maxStack: number;
}

export interface NodeModel {
  id: ObjId;
  slot: number;
  label: string;
  next: Target;
  prev: Target;
  color: string;
  /** written or created this step */
  pulse: boolean;
  /** created this step (drops in) */
  isNew: boolean;
}

export interface LinkChange {
  /** slot of the node whose link was written */
  from: number;
  key: 'next' | 'prev';
  /** where the link points now / pointed before (that arrow fades out) */
  now: Target;
  was: Target;
}

export interface PointerModel {
  /** variable key (stable React key) */
  id: string;
  name: string;
  slot: number;
  stack: number;
  color: string;
}

export interface ListModel {
  frame: ListFrame;
  nodes: NodeModel[];
  changes: LinkChange[];
  pointers: PointerModel[];
  /** some pointer holds null */
  nullUsed: boolean;
  /** what the camera should look at: the node whose link changed, a new node, the pointer that moved last */
  focusSlot: number | null;
}

const POINTER_HUES: [RegExp, string][] = [
  [/head|dummy|sentinel|^(list|l\d|first|start)$/i, COLORS.done],
  [/prev|slow|before/i, COLORS.frontier],
  [/next|fast|after/i, COLORS.window],
  [/tail|last|end/i, COLORS.visited],
];

export const pointerColor = (name: string) => POINTER_HUES.find(([re]) => re.test(name))?.[1] ?? COLORS.current;

/** The node's value as drawn (`5`, `'ab'`): '' before it is set, '•' for nodes without a value property. */
export function nodeLabel(tl: Timeline, snap: Snapshot, b: LinkedListBindings, id: ObjId): string {
  if (!b.valueKey) return '•';
  const slot = snap.heap.get(id)?.props?.get(b.valueKey);
  return slot ? previewValue(tl, snap, slot.v, { depth: 0, maxString: 6 }) : '';
}

function targetOf(v: V | undefined, slotOf: Map<ObjId, number>): Target {
  if (v === undefined) return undefined;
  if (v === null || isUndef(v)) return null;
  const id = refId(v);
  return id === null ? undefined : slotOf.get(id);
}

/**
 * The variable in the topmost running call of its function (the binding in scope wins, else the one the
 * frame still holds — a loop body's `const` between iterations); undefined when no running call holds it,
 * so a finished function's pointers disappear instead of lingering.
 */
function liveValue(tl: Timeline, ref: VarRef, i: number): V | undefined {
  const frames = tl.snapshots[i]?.frames;
  if (!frames) return undefined;
  for (let k = frames.size - 1; k >= 0; k--) {
    const f = frames.get(k) as FrameSnap;
    if (f.fnId !== ref.fnId) continue;
    let held: VarSlot | undefined;
    let visible: VarSlot | undefined;
    for (const bid of ref.bids) {
      const slot = f.vars.get(bid);
      if (!slot) continue;
      if (!held || slot.ord > held.ord) held = slot;
      if ((!visible || slot.ord > visible.ord) && isVisible(tl, f, bid, slot)) visible = slot;
    }
    return (visible ?? held)?.v;
  }
  return undefined;
}

const trackCache = new WeakMap<Timeline, Map<string, PointerTrack>>();

export function pointerTrack(tl: Timeline, b: LinkedListBindings, ref: VarRef): PointerTrack {
  let byKey = trackCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    trackCache.set(tl, byKey);
  }
  const key = `${b.nodeShape}|${varKey(ref)}|${ref.bids.join(',')}`;
  const hit = byKey.get(key);
  if (hit && hit.at.length === tl.steps.length) return hit;
  const nodes = new Set(b.nodeIds);
  const decode = (v: V | undefined): ObjId | null | undefined => {
    if (v === undefined) return undefined;
    // the trace records some null values as undefined, so both mean "points nowhere"
    if (v === null || isUndef(v)) return null;
    const id = refId(v);
    return id !== null && nodes.has(id) ? id : undefined;
  };
  const at: PointerTrack['at'] = [];
  const since: number[] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    at.push(decode(liveValue(tl, ref, i)));
    since.push(i > 0 && at[i] === at[i - 1] ? since[i - 1] : i);
  }
  const track = { at, since };
  byKey.set(key, track);
  return track;
}

interface Placed {
  /** index into the bindings' pointers */
  k: number;
  slot: number;
  stack: number;
}

/** Markers at step i: pointers holding a node (or null), stacked when several share a slot. */
function placePointers(b: LinkedListBindings, tracks: PointerTrack[], i: number, slotOf: Map<ObjId, number>, nullSlot: number): Placed[] {
  const out: Placed[] = [];
  const perSlot = new Map<number, number>();
  const shown = new Set<string>();
  b.pointers.forEach((ref, k) => {
    const at = tracks[k].at[i];
    const slot = at === undefined ? undefined : at === null ? nullSlot : slotOf.get(at);
    if (slot === undefined || slot < 0) return;
    // a parameter shadowing a same-named variable shows once when both hold the same node
    const tag = `${ref.name}@${slot}`;
    if (shown.has(tag)) return;
    shown.add(tag);
    const stack = perSlot.get(slot) ?? 0;
    perSlot.set(slot, stack + 1);
    out.push({ k, slot, stack });
  });
  return out;
}

const frameCache = new WeakMap<Timeline, Map<string, ListFrame & { n: number }>>();

/** Run-wide drawing frame: stable slots, the null and overflow slots, the widest arcs, the tallest marker stack. */
export function listFrame(tl: Timeline, b: LinkedListBindings): ListFrame {
  let byKey = frameCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    frameCache.set(tl, byKey);
  }
  const hit = byKey.get(b.nodeShape);
  if (hit && hit.n === tl.steps.length) return hit;
  const order = stableOrder(tl, b);
  const shown = Math.min(order.length, MAX_SLOTS);
  const hidden = order.length - shown;
  const slotOf = new Map(order.map((id, k) => [id, Math.min(k, MAX_SLOTS)] as const));
  const tracks = b.pointers.map((p) => pointerTrack(tl, b, p));
  const nullSlot = tracks.some((t) => t.at.includes(null)) ? shown + (hidden ? 1 : 0) : -1;
  let spanRight = 0;
  let spanLeft = 0;
  for (const [from, to] of linkPairs(tl, b)) {
    const a = slotOf.get(from) ?? MAX_SLOTS;
    if (a >= MAX_SLOTS) continue;
    const d = (slotOf.get(to) ?? MAX_SLOTS) - a;
    // a node linking to itself loops over the row like a two-slot arc
    spanRight = Math.max(spanRight, d === 0 ? 2 : d);
    spanLeft = Math.max(spanLeft, -d);
  }
  let maxStack = 0;
  for (let i = 0; i < tl.steps.length; i++) {
    for (const p of placePointers(b, tracks, i, slotOf, nullSlot)) maxStack = Math.max(maxStack, p.stack + 1);
  }
  const frame = {
    slotOf, hidden, nullSlot, slotCount: shown + (hidden ? 1 : 0) + (nullSlot >= 0 ? 1 : 0), spanRight, spanLeft, maxStack, n: tl.steps.length,
  };
  byKey.set(b.nodeShape, frame);
  return frame;
}

export function buildListModel(tl: Timeline, i: number, b: LinkedListBindings, hl: Highlight | null): ListModel {
  const frame = listFrame(tl, b);
  const { slotOf } = frame;
  const snap = tl.snapshots[i];
  const shown = (id: ObjId) => snap.heap.has(id) && (slotOf.get(id) ?? MAX_SLOTS) < MAX_SLOTS;
  const written = new Set<ObjId>();
  const created = new Set<ObjId>();
  const read = new Set<ObjId>();
  const changes: LinkChange[] = [];
  if (hl) {
    for (const h of hl.diff.heap) {
      if (!shown(h.id)) continue;
      if (h.op === 'alloc') {
        // stepping back over a creation: the node is simply not there yet
        if (!hl.reversed) created.add(h.id);
        continue;
      }
      if (h.op !== 'set') continue;
      written.add(h.id);
      const key = h.path[0] === b.nextKey ? 'next' : b.prevKey !== undefined && h.path[0] === b.prevKey ? 'prev' : null;
      if (!key) continue;
      const [now, was] = hl.reversed ? [h.old, h.value] : [h.value, h.old];
      changes.push({ from: slotOf.get(h.id) as number, key, now: targetOf(now, slotOf), was: targetOf(was, slotOf) });
    }
    for (const r of hl.diff.reads) if (shown(r.id)) read.add(r.id);
  }

  const nodes: NodeModel[] = [];
  for (const id of b.nodeIds) {
    if (!shown(id)) continue;
    const props = snap.heap.get(id)?.props;
    const isNew = created.has(id);
    const pulse = isNew || written.has(id);
    nodes.push({
      id,
      slot: slotOf.get(id) as number,
      label: nodeLabel(tl, snap, b, id),
      next: targetOf(props?.get(b.nextKey)?.v, slotOf),
      prev: b.prevKey ? targetOf(props?.get(b.prevKey)?.v, slotOf) : undefined,
      color: pulse ? COLORS.changed : read.has(id) ? COLORS.current : COLORS.idle,
      pulse,
      isNew,
    });
  }

  const tracks = b.pointers.map((p) => pointerTrack(tl, b, p));
  const placed = placePointers(b, tracks, i, slotOf, frame.nullSlot);
  const pointers = placed.map(({ k, slot, stack }) => ({
    id: varKey(b.pointers[k]), name: b.pointers[k].name, slot, stack, color: pointerColor(b.pointers[k].name),
  }));
  const latest = placed.reduce<Placed | null>((best, p) => (!best || tracks[p.k].since[i] > tracks[best.k].since[i] ? p : best), null);
  return {
    frame,
    nodes,
    changes,
    pointers,
    nullUsed: pointers.some((p) => p.slot === frame.nullSlot),
    focusSlot: changes[0]?.from ?? nodes.find((n) => n.isNew)?.slot ?? latest?.slot ?? null,
  };
}
