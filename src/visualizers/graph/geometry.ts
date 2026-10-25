/**
 * Graph view geometry (slot-local units): where an edge's line or arrow starts and ends (at the node
 * surfaces, shifted aside when the opposite direction is drawn too), where its weight goes, self-loops,
 * the title and the slot's reported size.
 */
import type { GraphLayout, Vec3 } from './layout';

export interface EdgeShape {
  from: Vec3;
  to: Vec3;
  /** Arrow bend (0: straight) */
  bend: number;
  /** weight label */
  label: Vec3;
}

/** gap between an arrow's tip and the node it points at */
const TIP_GAP = 0.03;
/** sideways shift of each direction of a two-way directed edge */
const SHIFT = 0.1;

const add = (p: Vec3, q: Vec3, k = 1): Vec3 => [p[0] + q[0] * k, p[1] + q[1] * k, p[2] + q[2] * k];

/** A small loop over the node. */
function selfLoop(p: Vec3, r: number): EdgeShape {
  return { from: add(p, [-0.55 * r, 0.8 * r, 0]), to: add(p, [0.55 * r, 0.8 * r, 0]), bend: 2.8, label: add(p, [0, 1.9 * r, 0.05]) };
}

/**
 * Surface to surface, an arrow's tip just off the target. `twoWay`: the reverse edge is drawn too, so each
 * direction keeps to its own right. The weight sits beside the middle (above it for near-horizontal edges).
 */
export function edgeShape(a: Vec3, b: Vec3, r: number, twoWay = false): EdgeShape {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  if (len < 1e-6) return selfLoop(a, r);
  const dir: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  const flat = Math.hypot(dir[0], dir[1]) || 1;
  // perpendicular in the front plane, to the right of the direction of travel
  const right: Vec3 = [dir[1] / flat, -dir[0] / flat, 0];
  const shift = twoWay ? SHIFT : 0;
  const from = add(add(a, dir, r), right, shift);
  const to = add(add(b, dir, -(r + TIP_GAP)), right, shift);
  const up: Vec3 = right[1] >= 0 ? right : [-right[0], -right[1], 0];
  const mid = add(a, d, 0.5);
  const label = twoWay ? add(mid, right, SHIFT + 0.2) : add(mid, up, 0.2);
  return { from, to, bend: 0, label: [label[0], label[1], label[2] + 0.06] };
}

export const TITLE_GAP = 0.45;

/** The slot's footprint and the title's place (above the top-left of the nodes). */
export function frameOf(layout: GraphLayout, titleWidth: number): { w: number; h: number; d: number; title: Vec3 } {
  const w = Math.max(layout.width, titleWidth) + 0.6;
  return { w, h: layout.height + TITLE_GAP + 0.35, d: layout.depth + 0.6, title: [-w / 2 + 0.3, layout.height + TITLE_GAP, 0] };
}
