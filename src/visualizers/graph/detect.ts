/**
 * Graphs: an adjacency list (`graph[u]` lists neighbor indexes or `[v, w]` pairs), an adjacency object /
 * Map (keys → arrays of keys) or an n×n adjacency matrix — walked by a traversal: a loop over one node's
 * neighbors (see walks.ts) inside a recursion that follows the edges, or beside a visited structure, a
 * frontier (queue / stack / priority queue) or distances it lowers — or an edge list of `[u, v, w]` items
 * whose loop relaxes the edge it is on (Bellman-Ford). Mode 'distances' when a distance array / Map
 * indexed by node is relaxed. The graph claims its arrays / objects, the edge list it was built from, its
 * recursive traversal functions and, in distances mode, the distances; the visited structure and the
 * frontier stay for their own views.
 */
import type { ObjInfo, TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ObjId } from '../../engine/types/values';
import { glyphSafe } from '../dp1d/table';
import type { DetectContext, Detection } from '../types';
import { findDist, findEdgeList, findFrontier, findVisited, lowersAtNeighbor, type FrontierShape, type Holding } from './roles';
import { scanGraph, type GraphKind, type GraphScan, type NodeId } from './structure';
import { findWalks, recursesOverEdges, type Walk } from './walks';

export interface GraphNode {
  id: NodeId;
  label: string;
}

export interface GraphBindings {
  graph: VarRef;
  /** the outer array / object / Map */
  objId: ObjId;
  kind: GraphKind;
  weighted: boolean;
  /** true unless every edge appears both ways */
  directed: boolean;
  /** stable order: indexes, or keys as first seen */
  nodes: GraphNode[];
  /** the node being expanded (node / u / curr) */
  current?: VarRef;
  /** the loop variable over its neighbors (next / v / nb) */
  neighbor?: VarRef;
  /** the loop variable holding the examined edge's weight */
  weight?: VarRef;
  /** the neighbor loop (its exit step examines nothing) */
  walkLoop?: number;
  visited?: VarRef;
  frontier?: VarRef;
  frontierShape?: FrontierShape;
  dist?: VarRef;
  /** the `[u, v(, w)]` list the adjacency was built from: its edges are drawn from the start */
  edgeList?: { ref: VarRef; objId: ObjId };
  /** functions holding the neighbor loops */
  traversalFns: number[];
}

export const GRAPH_SCORE = 0.9;
const MAX_LABEL = 6;

/**
 * Kinds an object could be the graph as: nested arrays (a 0/1 matrix also reads as lists of small
 * integers, so matrices go first: their walks are stricter; an edge list last), plain objects and Maps.
 */
const kindsOf = (o: ObjInfo): GraphKind[] =>
  o.kind === 'array' && o.nested ? ['matrix', 'list', 'edges'] : o.kind === 'map' || (o.kind === 'object' && !o.cls) ? ['object'] : [];

function varsOf(a: TraceAnalysis, o: ObjInfo): VarInfo[] {
  return [...o.varKeys].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
}

/** The variable the structure was created into, else the earliest one holding it. */
function creator(tl: Timeline, a: TraceAnalysis, o: ObjInfo): VarInfo | undefined {
  const vars = varsOf(a, o);
  const created = tl.diffs[o.allocStep]?.vars.find((c) => refId(c.value) === o.id);
  return vars.find((v) => created && v.ref.bids.includes(created.bid)) ?? vars.sort((x, y) => x.firstStep - y.firstStep)[0];
}

/** The graph's variable and title; a field (`this.adj`) is known through the variable holding its object (`g.adj`). */
function holderOf(tl: Timeline, a: TraceAnalysis, o: ObjInfo): { ref: VarRef; title: string } | undefined {
  const own = creator(tl, a, o);
  if (own) return { ref: own.ref, title: own.ref.name };
  for (const obj of tl.snapshots[tl.snapshots.length - 1].heap.values()) {
    const prop = obj.kind === 'object' ? [...(obj.props?.entries() ?? [])].find(([, slot]) => refId(slot.v) === o.id)?.[0] : undefined;
    const owner = prop === undefined ? undefined : a.objects.get(obj.id);
    const holder = owner && creator(tl, a, owner);
    if (holder) return { ref: holder.ref, title: `${holder.ref.name}.${prop}` };
  }
  return undefined;
}

const labelOf = (id: NodeId) => glyphSafe(id.length > MAX_LABEL ? `${id.slice(0, MAX_LABEL - 1)}…` : id);

const objClaims = (ids: Iterable<ObjId>) => [...ids].map((id) => `obj:${id}`);

function varClaims(a: TraceAnalysis, ids: Iterable<ObjId>): string[] {
  return [...ids].flatMap((id) => [...(a.objects.get(id)?.varKeys ?? [])]);
}

interface Candidate {
  o: ObjInfo;
  g: GraphScan;
  walks: Walk[];
}

interface Roles {
  frontier?: ReturnType<typeof findFrontier>;
  dist?: Holding;
  visited?: Holding;
  /** recursive functions calling themselves along edges */
  recursive: number[];
}

/** The structure is walked as a graph: along edges by recursion, beside a visited / frontier / distance structure. */
function traversed(ctx: DetectContext, g: GraphScan, walk: Walk, r: Roles): boolean {
  if (g.kind !== 'edges') return r.recursive.length > 0 || Boolean(r.frontier || r.visited || r.dist);
  // an edge list alone: its loop relaxes the edge it is on
  return Boolean(r.dist && walk.neighbor && lowersAtNeighbor(ctx, r.dist.objIds, walk.neighbor));
}

function detection(ctx: DetectContext, { o, g, walks }: Candidate): Detection<GraphBindings> | null {
  const { tl, analysis: a } = ctx;
  const holder = holderOf(tl, a, o);
  if (!holder) return null;
  const nodes = new Set(g.nodes);
  // a forEach callback holds the neighbor
  const fns = new Set(walks.flatMap((w) => [w.fnId, ...(w.neighbor ? [w.neighbor.fnId] : [])]));
  const [walk] = walks;
  const graphObjs = new Set([o.id, ...g.rows, ...g.items]);
  const frontier = findFrontier(ctx, nodes, fns, walk.current);
  const outside = new Set([...graphObjs, ...(frontier?.objIds ?? [])]);
  const dist = findDist(ctx, nodes, fns, outside);
  const visited = findVisited(ctx, nodes, fns, new Set([...outside, ...(dist?.objIds ?? [])]));
  const recursive = [...fns].filter((f) => recursesOverEdges(tl, a, f, g));
  if (!traversed(ctx, g, walk, { frontier, dist, visited, recursive })) return null;
  const edgeList = findEdgeList(ctx, g, outside);
  const weighted = g.weighted || Boolean(edgeList?.weighted);
  const claims = new Set([
    ...objClaims(graphObjs), varKey(holder.ref), ...o.varKeys, ...recursive.map((f) => `fn:${f}`),
    ...(edgeList ? [...objClaims([...edgeList.objIds, ...edgeList.items]), varKey(edgeList.ref), ...varClaims(a, edgeList.objIds)] : []),
    ...(dist ? [...objClaims(dist.objIds), varKey(dist.ref), ...varClaims(a, dist.objIds)] : []),
  ]);
  return {
    vizId: 'graph',
    key: `graph:obj:${o.id}`,
    title: holder.title,
    score: GRAPH_SCORE,
    role: 'primary',
    ...(dist && { mode: 'distances' }),
    claims: [...claims],
    bindings: {
      graph: holder.ref,
      objId: o.id,
      kind: g.kind,
      weighted,
      directed: g.directed,
      nodes: g.nodes.map((id) => ({ id, label: labelOf(id) })),
      ...(walk.current && { current: walk.current }),
      ...(walk.neighbor && { neighbor: walk.neighbor, walkLoop: walk.loopId }),
      ...(walk.weight && { weight: walk.weight }),
      ...(visited && { visited: visited.ref }),
      ...(frontier && { frontier: frontier.ref, frontierShape: frontier.shape }),
      ...(dist && { dist: dist.ref }),
      ...(edgeList && { edgeList: { ref: edgeList.ref, objId: edgeList.objIds[0] } }),
      traversalFns: [...fns].sort((x, y) => x - y),
    },
  };
}

export function detectGraphs(ctx: DetectContext): Detection<GraphBindings>[] {
  const { tl, analysis: a } = ctx;
  const found: Candidate[] = [];
  for (const o of a.objects.values()) {
    for (const kind of kindsOf(o)) {
      const g = scanGraph(tl, o.id, kind);
      const walks = g ? findWalks(tl, o.id, g) : [];
      if (!g || !walks.length) continue;
      found.push({ o, g, walks });
      break;
    }
  }
  // a graph's own rows can look like a (smaller) graph too
  const inner = new Set(found.flatMap((c) => [...c.g.rows, ...c.g.items]));
  const out = found.filter((c) => !inner.has(c.o.id) && c.g.kind !== 'edges').flatMap((c) => detection(ctx, c) ?? []);
  // an edge list an adjacency was built from is drawn with it
  const listed = new Set(out.flatMap((d) => (d.bindings.edgeList ? [d.bindings.edgeList.objId] : [])));
  return [...out, ...found.filter((c) => !inner.has(c.o.id) && c.g.kind === 'edges' && !listed.has(c.o.id)).flatMap((c) => detection(ctx, c) ?? [])];
}
