/**
 * Pure per-step model of the tree view (testable without WebGL). The run-wide frame keeps the drawing
 * still: stable node positions and bands for the visit-order strip, the pointer markers and the title. Per
 * step: the nodes that exist and their state — current (the node the active traversal call works on, else
 * the pointer that moved last), on the call path, visited, idle — the links (the one written this step
 * glows), the "null" a call is looking at, the pointer markers and the visit-order strip.
 */
import { varKey } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { previewValue } from '../../engine/timeline/values';
import type { ObjId } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import type { TreeBindings } from './detect';
import { placePointers, pointerColor, pointerTrack, type Placed } from './pointers';
import { buildForest, childrenAt, isBinary, layoutForest, linkChanges, nodeLabel, type LinkChange, type Vec2 } from './structure';
import { additions, returnedAt, visitedAt, walkAt, walkFacts } from './walk';

export const NODE_R = 0.36;
export const LEVEL_DY = 1.5;
/** nodes drawn at most (the shallowest levels first) */
export const MAX_NODES = 200;
export const STRIP_BLOCK = 0.5;
export const STRIP_PITCH = 0.62;
const MAX_STRIP = 64;
/** PointerMarker: label height above its tip, and the lift of each marker stacked on the same node */
const MARKER_H = 0.85;
const STACK_PITCH = 0.62;
/** room under the deepest level (a "null" a call looks at, return values), and the strip band below it */
const UNDER = 1.05;
const STRIP_BAND = 1.25;
/** where the "null" a call got sits, relative to its parent */
const NULL_DX = 0.45;
export const MARKER_LIFT = NODE_R + 0.06;

/** visited nodes and the visit-order blocks (finished calls are this green in the recursion tree) */
export const VISITED_COLOR = '#1f7a4d';

export type NodeState = 'current' | 'path' | 'visited' | 'idle';
export type EdgeState = 'changed' | 'path' | 'visited' | 'idle';

const LOOK: Record<NodeState, { color: string; glow: number }> = {
  current: { color: COLORS.current, glow: 1.25 },
  path: { color: COLORS.visited, glow: 0.35 },
  visited: { color: VISITED_COLOR, glow: 0.18 },
  idle: { color: COLORS.idle, glow: 0.08 },
};
const NEW_LOOK = { color: COLORS.changed, glow: 0.3 };
const EDGE_COLOR: Record<EdgeState, string> = { changed: COLORS.changed, path: COLORS.current, visited: '#2c6b52', idle: '#3a4a66' };

export interface TreeFrame {
  pos: Map<ObjId, Vec2>;
  /** nodes over the budget, not drawn */
  hidden: number;
  /** the first tree's root ("null" shows at its place while the tree is empty) */
  root: ObjId | null;
  width: number;
  height: number;
  titleY: number;
  /** block centers' height, the first block's x, blocks drawn at most */
  strip: { y: number; x0: number; len: number } | null;
  maxStack: number;
}

export interface NodeModel {
  id: ObjId;
  pos: Vec2;
  label: string;
  state: NodeState;
  color: string;
  glow: number;
  /** created this step (drops in) */
  isNew: boolean;
  /** what its finished traversal call of this walk returned (`= 3`) */
  badge?: string;
}

export interface EdgeModel {
  parent: ObjId;
  child: ObjId;
  state: EdgeState;
  color: string;
}

export interface PointerModel {
  /** variable key (stable React key) */
  id: string;
  name: string;
  node: ObjId;
  stack: number;
  color: string;
}

export interface StripModel {
  /** the array's variable */
  name: string;
  items: { label: string; pulse: boolean }[];
  /** elements past the drawn budget */
  more: number;
}

export interface TreeModel {
  frame: TreeFrame;
  nodes: NodeModel[];
  edges: EdgeModel[];
  pointers: PointerModel[];
  current: ObjId | null;
  /** nodes of the calls above the current one, root first */
  path: ObjId[];
  /** the null child the active call got: where its "null" shows, and its parent's center */
  nullAt: { pos: Vec2; parent: Vec2 | null } | null;
  strip: StripModel | null;
  /** links written by the highlighted step (new → old while it is undone) */
  changes: LinkChange[];
  /** what the camera should look at */
  focus: Vec2 | null;
}

const frameCache = new WeakMap<Timeline, Map<string, TreeFrame & { n: number }>>();

/** Run-wide drawing frame: stable positions, the tallest marker stack, the strip and title bands. */
export function treeFrame(tl: Timeline, b: TreeBindings): TreeFrame {
  let byKey = frameCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    frameCache.set(tl, byKey);
  }
  const hit = byKey.get(b.nodeShape);
  if (hit && hit.n === tl.steps.length) return hit;
  const forest = buildForest(tl, b);
  const layout = layoutForest(forest, isBinary(b), MAX_NODES, LEVEL_DY);
  const { outputs } = walkFacts(tl, b);
  const stripLen = Math.min(MAX_STRIP, Math.max(1, ...outputs.map((o) => o.maxLen)));
  const strip = outputs.length ? { y: 0.45, x0: -((stripLen - 1) * STRIP_PITCH) / 2, len: stripLen } : null;
  const base = (strip ? STRIP_BAND : 0) + UNDER;
  const pos = new Map<ObjId, Vec2>();
  for (const [id, [x, y]] of layout.pos) pos.set(id, [x, y + base]);
  const tracks = b.pointers.map((p) => pointerTrack(tl, b, p));
  let maxStack = 0;
  for (let i = 0; i < tl.steps.length; i++) {
    const heap = tl.snapshots[i].heap;
    for (const p of placePointers(b.pointers, tracks, i, (id) => pos.has(id) && heap.has(id))) maxStack = Math.max(maxStack, p.stack + 1);
  }
  const top = base + Math.max(0, layout.levels - 1) * LEVEL_DY;
  const titleY = top + MARKER_LIFT + (maxStack ? MARKER_H + (maxStack - 1) * STACK_PITCH : 0) + 0.45;
  const frame = {
    pos, hidden: layout.hidden, root: forest.roots.find((id) => pos.has(id)) ?? null,
    width: Math.max(layout.width + 2 * NULL_DX + 0.4, strip ? stripLen * STRIP_PITCH + 0.8 : 0, 4),
    height: titleY + 0.35, titleY, strip, maxStack, n: tl.steps.length,
  };
  byKey.set(b.nodeShape, frame);
  return frame;
}

export function buildTreeModel(tl: Timeline, i: number, b: TreeBindings, hl: Highlight | null): TreeModel {
  const frame = treeFrame(tl, b);
  const facts = walkFacts(tl, b);
  const snap = tl.snapshots[i];
  const drawn = (id: ObjId) => frame.pos.has(id) && snap.heap.has(id);
  const posOf = (id: ObjId | null | undefined) => (id === null || id === undefined ? null : frame.pos.get(id) ?? null);

  const tracks = b.pointers.map((p) => pointerTrack(tl, b, p));
  const placed = placePointers(b.pointers, tracks, i, drawn);
  const latest = placed.reduce<Placed | null>((best, p) => (!best || tracks[p.k].since[i] > tracks[best.k].since[i] ? p : best), null);
  const walk = walkAt(tl, i, b, facts);
  // without a running traversal call, the pointer that moved last marks the current node
  const current = walk.active ? (walk.current !== null && drawn(walk.current) ? walk.current : null) : latest?.node ?? null;
  const path = walk.path.filter(drawn);
  const onPath = new Set(path);
  const visited = visitedAt(facts, i);
  const returned = returnedAt(facts, i);

  const created = new Set<ObjId>();
  let changes: LinkChange[] = [];
  if (hl) {
    if (!hl.reversed) for (const h of hl.diff.heap) if (h.op === 'alloc' && drawn(h.id)) created.add(h.id);
    // the undone step's links are read against its own snapshot
    const at = tl.snapshots[hl.reversed ? Math.min(i + 1, tl.snapshots.length - 1) : i];
    changes = linkChanges(at, hl.diff.heap, b, facts.nodes)
      .filter((c) => drawn(c.parent))
      .map((c) => (hl.reversed ? { ...c, now: c.was, was: c.now } : c));
  }

  const nodes: NodeModel[] = [];
  for (const id of b.nodeIds) {
    if (!drawn(id)) continue;
    const state: NodeState = id === current ? 'current' : onPath.has(id) ? 'path' : visited.has(id) ? 'visited' : 'idle';
    const isNew = created.has(id);
    const look = isNew && state === 'idle' ? NEW_LOOK : LOOK[state];
    const value = returned.get(id);
    nodes.push({
      id, pos: frame.pos.get(id)!, label: nodeLabel(tl, snap, b, id), state, color: look.color, glow: look.glow, isNew,
      ...(value === undefined ? {} : { badge: `= ${previewValue(tl, snap, value, { depth: 0, maxString: 6 })}` }),
    });
  }

  const walking = (id: ObjId) => id === current || onPath.has(id);
  const edges: EdgeModel[] = [];
  for (const n of nodes) {
    for (const child of childrenAt(snap, b, n.id, facts.nodes)) {
      if (child === null || !drawn(child)) continue;
      const state: EdgeState = changes.some((c) => c.parent === n.id && c.now === child) ? 'changed'
        : walking(n.id) && walking(child) ? 'path' : visited.has(child) ? 'visited' : 'idle';
      edges.push({ parent: n.id, child, state, color: EDGE_COLOR[state] });
    }
  }

  let nullAt: TreeModel['nullAt'] = null;
  const nc = walk.nullChild;
  if (nc && nc.parent === null) {
    // a top-level call on an empty tree: "null" where the root will be
    const at = frame.root === null || drawn(frame.root) ? null : posOf(frame.root);
    if (at) nullAt = { pos: at, parent: null };
  } else if (nc && nc.parent !== null && drawn(nc.parent)) {
    const p = frame.pos.get(nc.parent)!;
    const dx = nc.slot === 0 ? -NULL_DX : nc.slot === 1 ? NULL_DX : 0;
    nullAt = { pos: [p[0] + dx, p[1] - LEVEL_DY / 2], parent: p };
  }

  let strip: StripModel | null = null;
  const outId = facts.activeOutput[i] ?? -1;
  if (frame.strip && outId >= 0) {
    const elems = snap.heap.get(outId)?.elems?.toArray() ?? [];
    const pushed = new Set<number>();
    if (hl && !hl.reversed) for (const h of hl.diff.heap) if (h.id === outId) for (const a of additions(h)) pushed.add(a.index);
    const shown = elems.slice(0, frame.strip.len);
    strip = {
      name: b.outputs.find((o) => o.objId === outId)?.ref.name ?? 'output',
      items: shown.map((v, k) => ({ label: previewValue(tl, snap, v, { depth: 0, maxString: 5 }), pulse: pushed.has(k) })),
      more: elems.length - shown.length,
    };
  }

  const pointers = placed.map(({ k, node, stack }) => ({
    id: varKey(b.pointers[k]), name: b.pointers[k].name, node, stack, color: pointerColor(b.pointers[k].name),
  }));
  const firstChange = changes[0];
  const focus = posOf(current) ?? nullAt?.pos ?? posOf([...created][0]) ?? posOf(firstChange?.now ?? firstChange?.parent)
    ?? posOf(latest?.node) ?? null;
  return { frame, nodes, edges, pointers, current, path, nullAt, strip, changes, focus };
}
