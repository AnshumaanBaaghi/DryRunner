/** Where the camera should look this step: each visualizer reports the world position of what changed. */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useSlotOrigin } from './layout';

type Vec3 = [number, number, number];

interface FocusState {
  points: Record<string, { pos: Vec3; priority: number; stamp: number }>;
  setPoint(id: string, pos: Vec3 | null, priority: number): void;
}

let stamp = 0;

export const useFocusStore = create<FocusState>((set, get) => ({
  points: {},
  setPoint(id, pos, priority) {
    const points = { ...get().points };
    if (pos) points[id] = { pos, priority, stamp: ++stamp };
    else delete points[id];
    set({ points });
  },
}));

/** Highest-priority, most recent focus point (world space). */
export function currentFocus(points: FocusState['points']): Vec3 | null {
  let best: { pos: Vec3; priority: number; stamp: number } | null = null;
  for (const p of Object.values(points)) {
    if (!best || p.priority > best.priority || (p.priority === best.priority && p.stamp > best.stamp)) best = p;
  }
  return best ? best.pos : null;
}

/** Report a focus point in the visualizer's local space (converted with the slot origin). */
export function useFocusPoint(id: string, local: Vec3 | null, priority: number, stepKey: string): void {
  const origin = useSlotOrigin();
  const x = local?.[0];
  const y = local?.[1];
  const z = local?.[2];
  useEffect(() => {
    const set = useFocusStore.getState().setPoint;
    if (x === undefined || y === undefined || z === undefined) set(id, null, priority);
    else set(id, [origin[0] + x, origin[1] + y, origin[2] + z], priority);
  }, [id, x, y, z, priority, stepKey, origin]);
  useEffect(() => () => useFocusStore.getState().setPoint(id, null, 0), [id]);
}
