/**
 * Pointer variables (pure): the node each holds at every step, read from the topmost running call of its
 * function (so a finished call's pointers vanish instead of lingering), and the markers of a step, stacked
 * when several share a node.
 */
import { varKey, type VarRef } from '../../engine/detect/track';
import { isVisible } from '../../engine/timeline/scope';
import type { FrameSnap, Timeline, VarSlot } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import { isUndef, type ObjId, type V } from '../../engine/types/values';
import { COLORS } from '../../scene/primitives/materials';
import type { TreeBindings } from './detect';

export interface PointerTrack {
  /** the node held at each step: an id, null, or undefined (no running call holds it, or not a node) */
  at: (ObjId | null | undefined)[];
  /** step since which `at` has held its current value */
  since: number[];
}

/** The binding in scope in the topmost running call of its function, else the one that frame still holds. */
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

const cache = new WeakMap<Timeline, Map<string, PointerTrack>>();

export function pointerTrack(tl: Timeline, b: Pick<TreeBindings, 'nodeShape' | 'nodeIds'>, ref: VarRef): PointerTrack {
  let byKey = cache.get(tl);
  if (!byKey) {
    byKey = new Map();
    cache.set(tl, byKey);
  }
  const key = `${b.nodeShape}|${varKey(ref)}|${ref.bids.join(',')}`;
  const hit = byKey.get(key);
  if (hit && hit.at.length === tl.steps.length) return hit;
  const nodes = new Set(b.nodeIds);
  const decode = (v: V | undefined): ObjId | null | undefined => {
    if (v === undefined) return undefined;
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

export interface Placed {
  /** index into the pointers */
  k: number;
  node: ObjId;
  stack: number;
}

/** Markers at step i: pointers holding a drawn node, stacked per node (a same-named pair on one node shows once). */
export function placePointers(refs: readonly VarRef[], tracks: readonly PointerTrack[], i: number, drawn: (id: ObjId) => boolean): Placed[] {
  const out: Placed[] = [];
  const perNode = new Map<ObjId, number>();
  const shown = new Set<string>();
  refs.forEach((ref, k) => {
    const node = tracks[k].at[i];
    if (node === undefined || node === null || !drawn(node)) return;
    const tag = `${ref.name}@${node}`;
    if (shown.has(tag)) return;
    shown.add(tag);
    const stack = perNode.get(node) ?? 0;
    perNode.set(node, stack + 1);
    out.push({ k, node, stack });
  });
  return out;
}

const HUES: [RegExp, string][] = [
  [/root|tree/i, COLORS.done],
  [/parent|prev|^p$/i, COLORS.frontier],
  [/left|right|child|kid|succ|pred/i, COLORS.window],
];

export const pointerColor = (name: string) => HUES.find(([re]) => re.test(name))?.[1] ?? COLORS.current;
