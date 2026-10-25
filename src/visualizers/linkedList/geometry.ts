/**
 * Linked-list view geometry (local units: x centered on 0, y up from the slot's floor): the row of node
 * blocks, links over it (pointing right) or under it (pointing left), null stubs, the pointer markers and
 * the title above them. Bands depend only on run-wide extremes, so nothing shifts between steps.
 */
import type { ListFrame } from './model';

export type Vec3 = [number, number, number];

export const SPACING = 2;
export const BLOCK: Vec3 = [1, 0.8, 0.8];
const HALF_W = BLOCK[0] / 2;
const HALF_H = BLOCK[1] / 2;
/** PointerMarker: label height above its tip, and the lift of each marker stacked on the same node */
const MARKER_H = 0.85;
const STACK_PITCH = 0.62;

/** apex height of an arc spanning `d` slots */
export const arcLift = (d: number) => Math.min(1.4, 0.35 + 0.25 * (d - 1));

export interface Bands {
  /** block centers */
  rowY: number;
  /** pointer marker tips */
  markerY: number;
  titleY: number;
  width: number;
  height: number;
}

export function bandsOf(frame: ListFrame): Bands {
  const rowY = (frame.spanLeft ? arcLift(frame.spanLeft) : 0) + 0.3 + HALF_H;
  // a link to the right-hand neighbor runs straight between the blocks; longer ones arc over the row
  const above = frame.spanRight > 1 ? arcLift(frame.spanRight) + 0.25 : 0.3;
  const markerY = rowY + HALF_H + above;
  const markersTop = frame.maxStack ? markerY + MARKER_H + (frame.maxStack - 1) * STACK_PITCH : markerY;
  const titleY = markersTop + 0.4;
  // 1.5 past the outer slot centers: room for a block, or for the last node's "null" stub
  return { rowY, markerY, titleY, width: Math.max(0, frame.slotCount - 1) * SPACING + 3, height: titleY + 0.35 };
}

export const xOf = (slot: number, slotCount: number) => (slot - (slotCount - 1) / 2) * SPACING;

export interface ArcSpec {
  from: Vec3;
  to: Vec3;
  /** Arrow's bend (arc height relative to the distance; negative arcs downward) */
  bend: number;
}

/** Arrow lifts its curve's control point by distance · bend · 0.35, which puts the apex at half that. */
const bendFor = (lift: number, dist: number) => (2 * lift) / (0.35 * Math.max(0.05, dist));

/**
 * A link from slot `a` to slot `b`: to the right-hand neighbor straight between the blocks, further right
 * over the row (top to top), to the left under it (bottom to bottom) — so a reversed list visibly flips.
 * Prev links sit lower and flatter so they never cover next links.
 */
export function linkArc(a: number, b: number, key: 'next' | 'prev', slotCount: number, rowY: number): ArcSpec {
  const xa = xOf(a, slotCount);
  const xb = xOf(b, slotCount);
  const prev = key === 'prev';
  if (a === b) {
    const top = rowY + HALF_H;
    return { from: [xa + 0.22, top, 0], to: [xa - 0.22, top, 0], bend: bendFor(arcLift(2), 0.44) };
  }
  if (b === a + 1) {
    const y = rowY + (prev ? -0.16 : 0.12);
    return { from: [xa + HALF_W, y, 0], to: [xb - HALF_W, y, 0], bend: 0.1 };
  }
  const up = b > a;
  const y = up ? rowY + HALF_H : rowY - HALF_H;
  const inset = prev ? 0.3 : 0.16;
  const from: Vec3 = [xa + (up ? inset : -inset), y, 0];
  const to: Vec3 = [xb + (up ? -inset : inset), y, 0];
  const lift = arcLift(Math.abs(b - a)) * (prev ? 0.8 : 1);
  return { from, to, bend: (up ? 1 : -1) * bendFor(lift, Math.abs(to[0] - from[0])) };
}

/** A null `next`: a short stub right of the block, and where its "null" goes. */
export function nullStub(a: number, slotCount: number, rowY: number): ArcSpec & { label: Vec3 } {
  const x = xOf(a, slotCount) + HALF_W;
  const y = rowY + 0.12;
  return { from: [x, y, 0], to: [x + 0.36, y, 0], bend: 0, label: [x + 0.68, y, 0] };
}
