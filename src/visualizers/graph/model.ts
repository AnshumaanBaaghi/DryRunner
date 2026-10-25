/**
 * Pure per-step model of the graph view (testable without WebGL): the run-wide frame — every edge ever
 * drawn (one per pair when undirected, pointing as the adjacency does) and the force layout, cached per
 * trace — and per step the edges present, the current node and the examined edge, visited / frontier
 * nodes with their visit order and, in distances mode, each node's distance and the one relaxed (old → new).
 */
import { trackVar, valueAt } from '../../engine/detect/track';
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ObjId } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import { cached, numText, type Cache } from '../dp1d/table';
import type { GraphBindings } from './detect';
import { forceLayout, type GraphLayout, type Vec3 } from './layout';
import { currentAt, distAt, examinedAt, firstVisits, frontierAt, visitedAt } from './state';
import { edgeItems, edgesAt, nodeIdOf, numberOf, scanGraph, type GraphEdge, type NodeId } from './structure';

export type NodeState = 'current' | 'frontier' | 'visited' | 'idle';
export type EdgeState = 'examined' | 'added' | 'idle';

export interface NodeModel {
  id: NodeId;
  label: string;
  pos: Vec3;
  state: NodeState;
  color: string;
  glow: number;
  /** 1 = visited first; null until visited */
  order: number | null;
  /** distances mode: `4`, `∞`; null without an entry */
  dist: string | null;
  /** relaxed this step: `6 → 5` */
  relax: string | null;
  /** its state changed this step, or it was relaxed */
  pulse: boolean;
}

export interface EdgeModel {
  key: string;
  from: NodeId;
  to: NodeId;
  a: Vec3;
  b: Vec3;
  /** weighted graphs: the weight as drawn */
  weight: string | null;
  state: EdgeState;
  /** became examined, or was added, this step */
  pulse: boolean;
}

export interface GraphFrame {
  layout: GraphLayout;
  /** node id → index into the bindings' nodes */
  index: Map<NodeId, number>;
  /** every edge drawn at some step */
  edges: GraphEdge[];
  /** pairs the edge list holds (drawn while it exists) */
  listed: Set<string>;
}

export interface GraphModel {
  frame: GraphFrame;
  nodes: NodeModel[];
  edges: EdgeModel[];
  current: NodeId | null;
  /** current → neighbor, when that edge exists */
  examined: { from: NodeId; to: NodeId } | null;
  relaxed: { node: NodeId; was: string; now: string } | null;
  /** visited nodes, first visited first */
  order: NodeId[];
  /** what the camera should look at: the current node, else the relaxed one, else an edge just added */
  focus: Vec3 | null;
  /** the graph (or the edge list it is built from) exists at this step */
  exists: boolean;
}

const COLOR: Record<NodeState, string> = { current: COLORS.current, frontier: COLORS.frontier, visited: COLORS.visited, idle: COLORS.idle };
const GLOW: Record<NodeState, number> = { current: 1.25, frontier: 0.55, visited: 0.35, idle: 0.08 };

type Index = ReadonlyMap<NodeId, number>;

/** One key per unordered pair. */
export const pairId = (index: Index, a: NodeId, b: NodeId) => {
  const [x, y] = [index.get(a) ?? -1, index.get(b) ?? -1];
  return x <= y ? `${x}-${y}` : `${y}-${x}`;
};

/** An edge's key as drawn: directed graphs keep both directions apart, undirected ones share the pair. */
export const edgeId = (b: GraphBindings, index: Index, from: NodeId, to: NodeId) =>
  (b.directed ? `${index.get(from) ?? -1}>${index.get(to) ?? -1}` : pairId(index, from, to));

/** `[u, v(, w)]` items of an edge list at a snapshot. */
export const listedAt = (tl: Timeline, snap: Snapshot, objId: ObjId): GraphEdge[] => edgeItems(tl, snap, objId)?.edges ?? [];

const frameCache: Cache<GraphFrame> = new WeakMap();

export function graphFrame(tl: Timeline, b: GraphBindings): GraphFrame {
  return cached(frameCache, tl, `${b.kind}:${b.objId}`, () => {
    const index = new Map(b.nodes.map((n, k) => [n.id, k]));
    const edges = new Map<string, GraphEdge>();
    const known = (e: GraphEdge) => index.has(e.from) && index.has(e.to);
    for (const e of scanGraph(tl, b.objId, b.kind)?.edges ?? []) {
      const key = edgeId(b, index, e.from, e.to);
      if (known(e) && !edges.has(key)) edges.set(key, e);
    }
    const listed = new Set<string>();
    if (b.edgeList) {
      const pairs = new Set([...edges.values()].map((e) => pairId(index, e.from, e.to)));
      for (const e of listedAt(tl, tl.snapshots[tl.snapshots.length - 1], b.edgeList.objId).filter(known)) {
        const pair = pairId(index, e.from, e.to);
        listed.add(pair);
        // the adjacency's direction wins (`[a, b]` pairs may build b → a)
        if (!pairs.has(pair)) edges.set(edgeId(b, index, e.from, e.to), e);
      }
    }
    const links = new Map<string, [number, number]>();
    for (const e of edges.values()) if (e.from !== e.to) links.set(pairId(index, e.from, e.to), [index.get(e.from)!, index.get(e.to)!]);
    const first = b.current ? trackVar(tl, b.current).map((v) => nodeIdOf(tl, v)).find((id) => id !== null && index.has(id)) : undefined;
    return { layout: forceLayout(b.nodes.length, [...links.values()], index.get(first ?? '') ?? 0), index, edges: [...edges.values()], listed };
  });
}

interface StepState {
  current: NodeId | null;
  examined: { from: NodeId; to: NodeId } | null;
  visited: Set<NodeId>;
  frontier: Set<NodeId>;
}

const stateAt = (tl: Timeline, b: GraphBindings, i: number): StepState => ({
  current: currentAt(tl, b, i), examined: examinedAt(tl, b, i), visited: visitedAt(tl, b, i), frontier: frontierAt(tl, b, i),
});

const nodeState = (s: StepState, id: NodeId): NodeState =>
  (s.current === id ? 'current' : s.frontier.has(id) ? 'frontier' : s.visited.has(id) ? 'visited' : 'idle');

/** Keys of the adjacency's edges at step i. */
function adjacencyAt(tl: Timeline, b: GraphBindings, index: Index, i: number): Set<string> {
  const snap = tl.snapshots[i];
  return new Set((snap ? edgesAt(tl, snap, b.objId, b.kind) ?? [] : []).map((e) => edgeId(b, index, e.from, e.to)));
}

/** A distance written lower by the highlighted step (stepping back: raised again). */
export function relaxationAt(tl: Timeline, b: GraphBindings, i: number, hl: Highlight | null): GraphModel['relaxed'] {
  const dist = b.dist && refId(valueAt(tl, b.dist, i));
  if (!hl || dist === undefined || dist === null) return null;
  for (const h of hl.diff.heap) {
    if (h.id !== dist) continue;
    const node = h.op === 'mapSet' ? nodeIdOf(tl, h.key) : h.op === 'set' && h.path.length === 1 ? String(h.path[0]) : null;
    const [old, value] = [numberOf(tl, h.old), numberOf(tl, h.value)];
    if (node === null || !b.nodes.some((n) => n.id === node) || old === undefined || value === undefined || value >= old) continue;
    const [was, now] = hl.reversed ? [value, old] : [old, value];
    return { node, was: numText(was), now: numText(now) };
  }
  return null;
}

export function buildGraphModel(tl: Timeline, i: number, b: GraphBindings, hl: Highlight | null): GraphModel {
  const frame = graphFrame(tl, b);
  const { index, layout } = frame;
  const now = stateAt(tl, b, i);
  // the step we came from (pulses mark what changed on the way)
  const from = hl ? (hl.reversed ? i + 1 : i - 1) : -1;
  const before = from >= 0 && from < tl.steps.length ? stateAt(tl, b, from) : null;
  const dist = distAt(tl, b, i);
  const relaxed = relaxationAt(tl, b, i, hl);
  const visits = firstVisits(tl, b);
  const order = [...now.visited].sort((x, y) => (visits.get(x) ?? i) - (visits.get(y) ?? i) || index.get(x)! - index.get(y)!);
  const rank = new Map(order.map((id, k) => [id, k + 1]));
  const nodes = b.nodes.map((n, k): NodeModel => {
    const state = nodeState(now, n.id);
    const d = dist.get(n.id);
    return {
      id: n.id, label: n.label, pos: layout.pos[k], state, color: COLOR[state], glow: GLOW[state], order: rank.get(n.id) ?? null,
      dist: d === undefined ? null : numText(d), relax: relaxed?.node === n.id ? `${relaxed.was} → ${relaxed.now}` : null,
      pulse: (before !== null && nodeState(before, n.id) !== state) || relaxed?.node === n.id,
    };
  });

  const snap = tl.snapshots[i];
  const adjacency = adjacencyAt(tl, b, index, i);
  const listed = b.edgeList && snap.heap.has(b.edgeList.objId) ? frame.listed : new Set<string>();
  const earlier = hl && !hl.reversed && i > 0 ? adjacencyAt(tl, b, index, i - 1) : adjacency;
  const keyOf = (s: StepState | null) => s?.examined && edgeId(b, index, s.examined.from, s.examined.to);
  const examinedKey = keyOf(now);
  const examinedBefore = keyOf(before);
  const pos = (id: NodeId) => layout.pos[index.get(id) ?? 0];
  const edges: EdgeModel[] = [];
  for (const e of frame.edges) {
    const key = edgeId(b, index, e.from, e.to);
    if (!adjacency.has(key) && !listed.has(pairId(index, e.from, e.to))) continue;
    const state: EdgeState = key === examinedKey ? 'examined' : adjacency.has(key) && !earlier.has(key) ? 'added' : 'idle';
    edges.push({
      key, from: e.from, to: e.to, a: pos(e.from), b: pos(e.to), weight: b.weighted && e.weight !== undefined ? numText(e.weight) : null, state,
      pulse: state === 'added' || (state === 'examined' && key !== examinedBefore),
    });
  }
  const examined = edges.some((e) => e.state === 'examined') ? now.examined : null;
  const added = edges.find((e) => e.state === 'added');
  const mid = (e: EdgeModel): Vec3 => [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
  return {
    frame, nodes, edges, current: now.current, examined, relaxed, order,
    focus: now.current !== null ? pos(now.current) : relaxed ? pos(relaxed.node) : added ? mid(added) : null,
    exists: snap.heap.has(b.objId) || listed.size > 0,
  };
}
