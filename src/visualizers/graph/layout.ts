/**
 * Stable node positions: a seeded 3D force layout (d3-force-3d) run to rest synchronously, pressed nearly
 * flat, turned so its long side is horizontal, started in the upper left and scaled into a 10 × 7 box
 * (slot-local units: x centered on 0, y up from the floor). A few seeded starts are tried and the one
 * with the fewest edge crossings (then the widest spacing) wins, so the same graph always lands the same.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type SimNode } from 'd3-force-3d';

export type Vec3 = [number, number, number];

export interface GraphLayout {
  /** node center by index into the node list */
  pos: Vec3[];
  radius: number;
  /** extent of the nodes, spheres included (y from 0: the floor leaves room under the lowest node) */
  width: number;
  height: number;
  depth: number;
}

/** most of the scene a graph may take */
export const BOX = { w: 10, h: 7 } as const;
/** space under the lowest node (its distance badge) */
export const FLOOR = 0.75;
const LINK = 30;
/** preferred edge length in scene units */
const EDGE = 2.3;
const MAX_RADIUS = 0.36;
const MIN_RADIUS = 0.12;
const MAX_Z = 0.8;
const TICKS = 300;
/** graphs up to this size try several seeded starts; past it nodes are kept apart by a collision force */
const CROWDED = 24;
/** past these sizes: one start, fewer ticks */
const BIG = 60;
const HUGE = 200;

/** Deterministic [0, 1) generator (mulberry32). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Effort by size: small graphs try several starts; crowded ones keep nodes apart; big ones settle in fewer ticks. */
function effort(n: number): { attempts: number; ticks: number; collide: boolean } {
  if (n <= CROWDED) return { attempts: 4, ticks: TICKS, collide: false };
  if (n <= BIG) return { attempts: 2, ticks: TICKS, collide: true };
  return { attempts: 1, ticks: n <= HUGE ? TICKS / 2 : TICKS / 4, collide: false };
}

function simulate(n: number, links: [number, number][], attempt: number): Vec3[] {
  const { ticks, collide } = effort(n);
  const rnd = seeded(attempt * 7919 + 1);
  // attempt 0 starts from d3's own (index-seeded) spiral
  const nodes: SimNode[] = Array.from({ length: n }, () => (attempt === 0 ? {} : { x: (rnd() - 0.5) * 2 * LINK, y: (rnd() - 0.5) * 2 * LINK, z: (rnd() - 0.5) * 2 * LINK }));
  const sim = forceSimulation(nodes, 3).stop().randomSource(seeded(attempt + 11))
    .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
    .force('link', forceLink(links.map(([source, target]) => ({ source, target }))).distance(LINK))
    .force('charge', forceManyBody().strength(-60))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.06))
    .force('z', forceZ(0).strength(0.3));
  if (collide) sim.force('collide', forceCollide(LINK * 0.3));
  sim.tick(ticks);
  return nodes.map((p) => [p.x ?? 0, p.y ?? 0, p.z ?? 0]);
}

const side = (a: Vec3, b: Vec3, c: Vec3) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** Edges crossing in the front view (xy). */
export function crossings(pos: Vec3[], links: [number, number][]): number {
  let n = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const [a, b] = links[i];
      const [c, d] = links[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (side(pos[a], pos[b], pos[c]) * side(pos[a], pos[b], pos[d]) < 0 && side(pos[c], pos[d], pos[a]) * side(pos[c], pos[d], pos[b]) < 0) n += 1;
    }
  }
  return n;
}

/** Distance from each node to its nearest one in the front view. */
function nearest(pos: Vec3[]): number[] {
  return pos.map((p, i) => {
    let best = Infinity;
    for (let j = 0; j < pos.length; j++) if (j !== i) best = Math.min(best, Math.hypot(p[0] - pos[j][0], p[1] - pos[j][1]));
    return best;
  });
}

/** Closest two nodes in the front view. */
export const minSpacing = (pos: Vec3[]) => Math.min(...nearest(pos));

/** Spacing most nodes have: the 10th percentile of nearest-node distances (a few crowded ones don't shrink every node). */
function typicalSpacing(pos: Vec3[]): number {
  const d = nearest(pos).sort((x, y) => x - y);
  return d[Math.floor(d.length * 0.1)] ?? Infinity;
}

/** Centered, long side along x, the start node in the upper left. */
function orient(pos: Vec3[], start: number): Vec3[] {
  const n = pos.length;
  const c = pos.reduce<Vec3>((m, p) => [m[0] + p[0] / n, m[1] + p[1] / n, m[2] + p[2] / n], [0, 0, 0]);
  const centered = pos.map((p): Vec3 => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of centered) {
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const turned = centered.map(([x, y, z]): Vec3 => [x * cos - y * sin, x * sin + y * cos, z]);
  const fx = (turned[start]?.[0] ?? 0) > 1e-6 ? -1 : 1;
  const fy = (turned[start]?.[1] ?? 0) < -1e-6 ? -1 : 1;
  return turned.map(([x, y, z]): Vec3 => [x * fx, y * fy, z]);
}

/**
 * Positions for nodes 0 … n−1 joined by `links` (index pairs, either direction). `start` (the first
 * node visited) ends up toward the upper left.
 */
export function forceLayout(n: number, links: [number, number][], start = 0): GraphLayout {
  if (n === 0) return { pos: [], radius: MAX_RADIUS, width: 0, height: 0, depth: 0 };
  const { attempts } = effort(n);
  let best: { pos: Vec3[]; cross: number; spacing: number } | null = null;
  for (let k = 0; k < attempts; k++) {
    const pos = simulate(n, links, k);
    const cross = attempts > 1 ? crossings(pos, links) : 0;
    const spacing = minSpacing(pos);
    if (!best || cross < best.cross || (cross === best.cross && spacing > best.spacing)) best = { pos, cross, spacing };
  }
  const pos = orient(best!.pos, start);
  const xs = pos.map((p) => p[0]);
  const ys = pos.map((p) => p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const lengths = links.map(([a, b]) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1])).filter((l) => l > 1e-6).sort((x, y) => x - y);
  const typical = lengths[Math.floor(lengths.length / 2)] ?? LINK;
  const scale = Math.min(EDGE / typical, (BOX.w - 2 * MAX_RADIUS) / Math.max(spanX, 1e-6), (BOX.h - FLOOR - 2 * MAX_RADIUS) / Math.max(spanY, 1e-6));
  const radius = n > 1 ? Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, 0.32 * typicalSpacing(pos) * scale)) : MAX_RADIUS;
  const minY = Math.min(...ys);
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const placed = pos.map(([x, y, z]): Vec3 => [(x - midX) * scale, FLOOR + radius + (y - minY) * scale, Math.max(-MAX_Z, Math.min(MAX_Z, z * scale))]);
  const zs = placed.map((p) => p[2]);
  return {
    pos: placed,
    radius,
    width: spanX * scale + 2 * radius,
    height: FLOOR + spanY * scale + 2 * radius,
    depth: Math.max(...zs) - Math.min(...zs) + 2 * radius,
  };
}
