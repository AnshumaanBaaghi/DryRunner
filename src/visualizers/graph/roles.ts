/**
 * What a traversal keeps beside the graph: the frontier (a queue, stack or priority queue of nodes, or
 * of `[dist, node]` items), the visited marks (a Set, Map, object or array keyed by node), the distances
 * it relaxes (`dist[v]` rewritten with a smaller value) and the edge list the adjacency was built from.
 * Pure; every structure is found through the variable holding it.
 */
import type { ObjInfo, TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import { frameById, isVisible } from '../../engine/timeline/scope';
import type { HeapChange, Snapshot, Timeline } from '../../engine/timeline/types';
import { deref } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import { detectQueues } from '../queue/detect';
import { knownBy } from '../queue/model';
import { detectStacks } from '../stack/detect';
import type { DetectContext } from '../types';
import { edgeItems, edgeKey, nodeIdOf, numberOf, type GraphScan, type NodeId } from './structure';

export interface FrontierShape {
  kind: 'queue' | 'stack' | 'priority';
  /** class / object queues: the items array is this property of the held object */
  prop?: string;
  /** head-index queues (`queue[head++]`): items before `head` are gone */
  head?: VarRef;
  /** array items (`[dist, node]`): the element naming the node */
  slot?: number;
}

export interface Holding {
  ref: VarRef;
  /** every object the variable held in that role */
  objIds: ObjId[];
}

const FRONTIER_HINT = /queue|^q$|stack|^st$|frontier|pq|heap|open|todo|deque|fringe|work|bag/i;
const VISITED_HINT = /visit|seen|explored|mark|discover|done|used|colou?r|state|closed|^vis$/i;
const DIST_HINT = /dist|cost|short|best|^d$/i;

/** The step's function. */
const fnAt = (tl: Timeline, s: number) => tl.calls.get(tl.steps[s]?.callId ?? -1)?.fnId ?? 0;

/** The node an item names: itself, an array element (`slot`, else any), or an object's id / node field. */
export function itemNode(tl: Timeline, snap: Snapshot, v: V | undefined, nodes: ReadonlySet<NodeId>, slot?: number): NodeId | null {
  const id = nodeIdOf(tl, v);
  if (id !== null) return nodes.has(id) ? id : null;
  const obj = deref(snap, v);
  if (obj?.kind === 'array') {
    const elems = obj.elems?.toArray() ?? [];
    const picks = slot === undefined ? elems : [elems[slot]];
    return picks.map((e) => nodeIdOf(tl, e)).find((n): n is NodeId => n !== null && nodes.has(n)) ?? null;
  }
  const known = nodeIdOf(tl, knownBy(snap, obj));
  return known !== null && nodes.has(known) ? known : null;
}

function varsHolding(a: TraceAnalysis, o: ObjInfo): VarInfo[] {
  return [...o.varKeys].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
}

/** variable key → how strongly it holds the role, and the objects it held in it */
type Votes = Map<string, { info: VarInfo; n: number; objIds: Set<ObjId> }>;

function vote(a: TraceAnalysis, votes: Votes, o: ObjInfo, n: number): void {
  for (const info of varsHolding(a, o)) {
    const key = varKey(info.ref);
    const v = votes.get(key) ?? { info, n: 0, objIds: new Set<ObjId>() };
    v.n += n;
    v.objIds.add(o.id);
    votes.set(key, v);
  }
}

/** The hinted name wins, then the most votes, then the earliest variable. */
function bestHolder(votes: Votes, hint: RegExp): Holding | undefined {
  const ranked = [...votes.values()].filter((v) => v.n > 0)
    .sort((x, y) => Number(hint.test(y.info.ref.name)) - Number(hint.test(x.info.ref.name)) || y.n - x.n || x.info.firstStep - y.info.firstStep);
  return ranked[0] && { ref: ranked[0].info.ref, objIds: [...ranked[0].objIds] };
}

/** Which element of the removed `[dist, node]` items the current variable takes (`const [d, u] = pq.shift()`). */
function itemSlot(tl: Timeline, objIds: ReadonlySet<ObjId>, current: VarRef | undefined): number | undefined {
  const votes = new Map<number, number>();
  let width = 0;
  for (let s = 1; s < tl.diffs.length; s++) {
    for (const h of tl.diffs[s].heap) {
      if (!objIds.has(h.id) || (h.op !== 'shift' && h.op !== 'pop')) continue;
      const elems = deref(tl.snapshots[s], h.old)?.elems?.toArray();
      if (!elems) continue;
      width = Math.max(width, elems.length);
      const got = tl.diffs[s].vars.find((c) => current?.bids.includes(c.bid));
      const node = got && nodeIdOf(tl, got.value);
      const hits = elems.flatMap((e, k) => (node && nodeIdOf(tl, e) === node ? [k] : []));
      if (hits.length === 1) votes.set(hits[0], (votes.get(hits[0]) ?? 0) + 1);
    }
  }
  const best = [...votes].sort((x, y) => y[1] - x[1])[0];
  if (best) return best[0];
  // `[priority, node]` is the usual order
  return width ? Math.min(1, width - 1) : undefined;
}

/** A queue / stack / priority queue the traversal adds nodes to. */
export function findFrontier(ctx: DetectContext, nodes: ReadonlySet<NodeId>, fns: ReadonlySet<number>, current?: VarRef):
  (Holding & { shape: FrontierShape }) | undefined {
  const { tl } = ctx;
  const found: { ref: VarRef; claims: string[]; shape: FrontierShape }[] = [
    ...detectQueues(ctx).map(({ bindings: q, mode, claims }) => {
      const shape: FrontierShape = { kind: mode === 'priority' ? 'priority' : 'queue', ...(q.prop && { prop: q.prop }), ...(q.head && { head: q.head }) };
      return { ref: q.target, claims, shape };
    }),
    ...detectStacks(ctx).map(({ bindings, claims }) => ({ ref: bindings.target, claims, shape: { kind: 'stack' as const } })),
  ];
  let best: { ref: VarRef; objIds: Set<ObjId>; shape: FrontierShape; n: number } | undefined;
  for (const { ref, claims, shape } of found) {
    const objIds = new Set(claims.filter((c) => c.startsWith('obj:')).map((c) => Number(c.slice(4))));
    let n = 0;
    tl.diffs.forEach((diff, s) => {
      if (!fns.has(fnAt(tl, s))) return;
      for (const h of diff.heap) {
        if (!objIds.has(h.id) || (h.op !== 'push' && h.op !== 'unshift' && h.op !== 'splice')) continue;
        for (const v of h.args ?? []) if (itemNode(tl, tl.snapshots[s], v, nodes) !== null) n += 1;
      }
    });
    const rank = n + (FRONTIER_HINT.test(ref.name) ? 0.5 : 0);
    if (n > 0 && (!best || rank > best.n)) best = { ref, objIds, shape, n: rank };
  }
  if (!best) return undefined;
  const slot = itemSlot(tl, best.objIds, current);
  return { ref: best.ref, objIds: [...best.objIds], shape: slot === undefined ? best.shape : { ...best.shape, slot } };
}

/** The node a write marks: a Set / Map key, an object key or an array index. */
function markedNode(tl: Timeline, o: ObjInfo, h: HeapChange): NodeId | null {
  if (o.kind === 'set') return h.op === 'setAdd' ? nodeIdOf(tl, h.key) : null;
  if (o.kind === 'map') return h.op === 'mapSet' ? nodeIdOf(tl, h.key) : null;
  if (h.op !== 'set' || h.path.length !== 1) return null;
  if (o.kind === 'array') return typeof h.path[0] === 'number' && !o.nested ? String(h.path[0]) : null;
  return o.kind === 'object' && !o.cls ? String(h.path[0]) : null;
}

interface Writes {
  /** writes keyed by a node */
  marks: number;
  /** numbers lowered / raised, and lowered by exactly one (`indegree[v]--`) */
  lowered: number;
  raised: number;
  decrements: number;
}

/** Per object: the writes keyed by a node during the traversal, and how they changed numbers. */
function writesByObject(ctx: DetectContext, nodes: ReadonlySet<NodeId>, fns: ReadonlySet<number>, exclude: ReadonlySet<ObjId>): Map<ObjId, Writes> {
  const { tl, analysis: a } = ctx;
  const out = new Map<ObjId, Writes>();
  tl.diffs.forEach((diff, s) => {
    if (!fns.has(fnAt(tl, s))) return;
    for (const h of diff.heap) {
      const o = a.objects.get(h.id);
      if (!o || exclude.has(h.id)) continue;
      const node = markedNode(tl, o, h);
      if (node === null || !nodes.has(node)) continue;
      const w = out.get(h.id) ?? { marks: 0, lowered: 0, raised: 0, decrements: 0 };
      w.marks += 1;
      const was = numberOf(tl, h.old);
      const now = numberOf(tl, h.value);
      if (was !== undefined && now !== undefined) {
        if (now < was) w.lowered += 1;
        if (now > was) w.raised += 1;
        if (was - now === 1) w.decrements += 1;
      }
      out.set(h.id, w);
    }
  });
  return out;
}

/** The distances: node entries the traversal only ever lowers — not all by one, as counters (in-degrees) go down. */
export function findDist(ctx: DetectContext, nodes: ReadonlySet<NodeId>, fns: ReadonlySet<number>, exclude: ReadonlySet<ObjId>): Holding | undefined {
  const votes: Votes = new Map();
  for (const [id, w] of writesByObject(ctx, nodes, fns, exclude)) {
    if (w.lowered > w.decrements && w.raised === 0) vote(ctx.analysis, votes, ctx.analysis.objects.get(id)!, w.lowered);
  }
  return bestHolder(votes, DIST_HINT);
}

/** Some write lowers a distance at the node `neighbor` holds (in scope) right then: relaxing the edge being looked at. */
export function lowersAtNeighbor(ctx: DetectContext, objIds: readonly ObjId[], neighbor: VarRef): boolean {
  const { tl, analysis: a } = ctx;
  const ids = new Set(objIds);
  return tl.diffs.some((diff, s) => diff.heap.some((h) => {
    const o = a.objects.get(h.id);
    const [was, now] = [numberOf(tl, h.old), numberOf(tl, h.value)];
    const frame = frameById(tl.snapshots[s], tl.steps[s].callId);
    if (!o || !frame || !ids.has(h.id) || was === undefined || now === undefined || now >= was) return false;
    const key = markedNode(tl, o, h);
    return neighbor.bids.some((bid) => {
      const slot = frame.vars.get(bid);
      return slot !== undefined && isVisible(tl, frame, bid, slot) && nodeIdOf(tl, slot.v) === key;
    });
  }));
}

/** The visited marks: a Set / Map / object / array the traversal marks nodes in (marks never count down). */
export function findVisited(ctx: DetectContext, nodes: ReadonlySet<NodeId>, fns: ReadonlySet<number>, exclude: ReadonlySet<ObjId>): Holding | undefined {
  const votes: Votes = new Map();
  for (const [id, w] of writesByObject(ctx, nodes, fns, exclude)) if (w.lowered === 0) vote(ctx.analysis, votes, ctx.analysis.objects.get(id)!, w.marks);
  return bestHolder(votes, VISITED_HINT);
}

/** Pairs / triples `[u, v(, w)]` of nodes, never queued or sorted, whose pairs are (mostly) the graph's edges. */
export function findEdgeList(ctx: DetectContext, g: GraphScan, exclude: ReadonlySet<ObjId>): (Holding & { items: ObjId[]; weighted: boolean }) | undefined {
  const { tl, analysis: a } = ctx;
  const last = tl.snapshots[tl.snapshots.length - 1];
  const nodes = new Set(g.nodes);
  const pairs = new Set(g.edges.flatMap((e) => [edgeKey(e.from, e.to), edgeKey(e.to, e.from)]));
  let best: (Holding & { items: ObjId[]; weighted: boolean }) | undefined;
  for (const o of a.objects.values()) {
    if (o.kind !== 'array' || !o.nested || exclude.has(o.id) || ['shift', 'pop', 'sort', 'unshift', 'splice'].some((op) => o.ops[op])) continue;
    const found = edgeItems(tl, last, o.id);
    const [holder] = varsHolding(a, o).sort((x, y) => x.firstStep - y.firstStep);
    if (!found?.edges.length || !holder || (best && best.items.length >= found.items.length)) continue;
    if (!found.edges.every((e) => nodes.has(e.from) && nodes.has(e.to))) continue;
    if (found.edges.filter((e) => pairs.has(edgeKey(e.from, e.to))).length < 0.8 * found.edges.length) continue;
    best = { ref: holder.ref, objIds: [o.id], items: found.items, weighted: found.edges.some((e) => e.weight !== undefined) };
  }
  return best;
}
