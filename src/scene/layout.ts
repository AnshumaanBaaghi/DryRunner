/**
 * Non-overlapping placement of active visualizers: the primary in the center, the secondary to its
 * right, aux structures in columns (left by default, right for the call stack). Each visualizer reports
 * its bounding size (`useReportSize`); `LayoutRoot` renders the slots.
 */
import { createContext, useContext, useEffect } from 'react';
import { create } from 'zustand';

export type SlotRole = 'primary' | 'secondary' | 'aux';
export type SlotSide = 'left' | 'right';

export interface SlotSize {
  w: number;
  h: number;
  d: number;
}

export interface SlotSpec {
  id: string;
  role: SlotRole;
  side?: SlotSide;
  order: number;
}

export type Vec3 = [number, number, number];

export const GAP = 2.2;
const DEFAULT_SIZE: SlotSize = { w: 4, h: 3, d: 1 };

/** Pure placement: returns slot centers (x, bottom y, z) and the overall bounds. */
export function computeLayout(specs: SlotSpec[], sizes: Record<string, SlotSize>): {
  positions: Record<string, Vec3>;
  bounds: { min: Vec3; max: Vec3 };
} {
  const size = (id: string) => sizes[id] ?? DEFAULT_SIZE;
  const positions: Record<string, Vec3> = {};
  const sorted = [...specs].sort((a, b) => a.order - b.order);
  const primary = sorted.find((s) => s.role === 'primary') ?? sorted[0];
  const secondaries = sorted.filter((s) => s !== primary && s.role === 'secondary');
  const aux = sorted.filter((s) => s !== primary && s.role === 'aux');
  let right = 0;
  let left = 0;
  if (primary) {
    const p = size(primary.id);
    positions[primary.id] = [0, 0, 0];
    right = p.w / 2;
    left = -p.w / 2;
  }
  for (const s of secondaries) {
    const sz = size(s.id);
    positions[s.id] = [right + GAP + sz.w / 2, 0, 0];
    right += GAP + sz.w;
  }
  const columns: Record<SlotSide, SlotSpec[]> = { left: [], right: [] };
  for (const s of aux) columns[s.side ?? 'left'].push(s);
  for (const side of ['right', 'left'] as const) {
    const col = columns[side];
    if (!col.length) continue;
    const colW = Math.max(...col.map((s) => size(s.id).w));
    const x = side === 'right' ? right + GAP + colW / 2 : left - GAP - colW / 2;
    let y = 0;
    for (const s of col) {
      positions[s.id] = [x, y, 0];
      y += size(s.id).h + GAP * 0.6;
    }
    if (side === 'right') right += GAP + colW;
    else left -= GAP + colW;
  }
  let minY = 0;
  let maxY = 0;
  let maxD = 0;
  for (const s of specs) {
    const [, y] = positions[s.id] ?? [0, 0, 0];
    const sz = size(s.id);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + sz.h);
    maxD = Math.max(maxD, sz.d);
  }
  return { positions, bounds: { min: [left, minY, -maxD / 2], max: [right, maxY, maxD / 2] } };
}

interface LayoutState {
  sizes: Record<string, SlotSize>;
  bounds: { min: Vec3; max: Vec3 };
  /** every slot has reported its size (bounds are final, not placeholder-based) */
  complete: boolean;
  report(id: string, size: SlotSize): void;
  setBounds(b: LayoutState['bounds'], complete: boolean): void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sizes: {},
  bounds: { min: [-4, 0, -1], max: [4, 3, 1] },
  complete: false,
  report(id, size) {
    const prev = get().sizes[id];
    if (prev && Math.abs(prev.w - size.w) < 0.01 && Math.abs(prev.h - size.h) < 0.01 && Math.abs(prev.d - size.d) < 0.01) return;
    set({ sizes: { ...get().sizes, [id]: size } });
  },
  setBounds(b, complete) {
    const cur = get().bounds;
    const same = cur.min.every((v, k) => Math.abs(v - b.min[k]) < 0.01) && cur.max.every((v, k) => Math.abs(v - b.max[k]) < 0.01);
    if (same && complete === get().complete) return;
    set(same ? { complete } : { bounds: b, complete });
  },
}));

export const SlotContext = createContext<{ id: string; origin: Vec3 }>({ id: '', origin: [0, 0, 0] });

export function useSlotOrigin(): Vec3 {
  return useContext(SlotContext).origin;
}

/** Visualizers call this with their current footprint (width along x, height along y, depth). */
export function useReportSize(size: SlotSize): void {
  const { id } = useContext(SlotContext);
  const { w, h, d } = size;
  useEffect(() => {
    if (id) useLayoutStore.getState().report(id, { w, h, d });
  }, [id, w, h, d]);
}
