/**
 * Per-step value of a variable (by declaring function + binding ids): the topmost frame of that function
 * that holds the binding wins (recursion shows the current call's value); once a value was seen it is
 * carried forward after the frame returns, so a structure stays visible after its function ends.
 */
import type { FrameSnap, Timeline } from '../timeline/types';
import type { V } from '../types/values';

export interface VarRef {
  name: string;
  fnId: number;
  bids: number[];
}

export const varKey = (ref: Pick<VarRef, 'name' | 'fnId'>) => `${ref.fnId}:${ref.name}`;

const cache = new WeakMap<Timeline, Map<string, { length: number; values: (V | undefined)[] }>>();

function frameValue(frame: FrameSnap, bids: number[]): V | undefined {
  for (const bid of bids) {
    const slot = frame.vars.get(bid);
    if (slot) return slot.v;
  }
  return undefined;
}

export function trackVar(tl: Timeline, ref: VarRef): (V | undefined)[] {
  let byKey = cache.get(tl);
  if (!byKey) {
    byKey = new Map();
    cache.set(tl, byKey);
  }
  const key = `${varKey(ref)}:${ref.bids.join(',')}`;
  const hit = byKey.get(key);
  const n = tl.steps.length;
  if (hit && hit.length === n) return hit.values;
  const values: (V | undefined)[] = hit ? hit.values.slice(0, hit.length) : [];
  let last = values.length ? values[values.length - 1] : undefined;
  for (let i = values.length; i < n; i++) {
    const frames = tl.snapshots[i].frames;
    let found: V | undefined;
    for (let k = frames.size - 1; k >= 0; k--) {
      const f = frames.get(k) as FrameSnap;
      if (f.fnId !== ref.fnId) continue;
      found = frameValue(f, ref.bids);
      if (found !== undefined) break;
    }
    if (found === undefined && ref.fnId !== 0) {
      // closure frames (exited) still hold the binding
      for (const f of tl.snapshots[i].detached.values()) {
        if (f.fnId === ref.fnId) {
          found = frameValue(f, ref.bids);
          if (found !== undefined) break;
        }
      }
    }
    if (found !== undefined) last = found;
    values.push(last);
  }
  byKey.set(key, { length: n, values });
  return values;
}

/** Value of a variable at step i, or undefined before it ever existed. */
export function valueAt(tl: Timeline, ref: VarRef, i: number): V | undefined {
  return trackVar(tl, ref)[i];
}
