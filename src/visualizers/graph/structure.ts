/**
 * Graph structures read from the heap (pure): node ids decoded from trace values, the rows of an
 * adjacency list / keyed object or Map / matrix at a snapshot, the items of an edge list, their edges,
 * and a run-wide scan of one structure (every node and edge it ever held, the objects holding them,
 * weighted / directed).
 */
import { orderedEntries, orderedProps } from '../../engine/timeline/heap';
import type { HeapObj, Snapshot, Timeline } from '../../engine/timeline/types';
import { deref, isObj, primitive, refId } from '../../engine/timeline/values';
import { isUndef, type ObjId, type V } from '../../engine/types/values';
import { cached, type Cache } from '../dp1d/table';

/** list: `graph[u]` lists neighbors · object: keys → lists of keys (or a Map) · matrix: n×n cells · edges: `[u, v(, w)]` items */
export type GraphKind = 'list' | 'object' | 'matrix' | 'edges';
/** canonical node id: `3` for the integer 3, `A` for the string 'A' */
export type NodeId = string;

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  weight?: number;
}

export interface Row {
  node: NodeId;
  /** the node's inner list / Set / matrix row (null: none yet) */
  id: ObjId | null;
}

export interface Entry {
  to: NodeId;
  weight?: number;
  /** the `[node, weight]` pair the entry is */
  item?: ObjId;
}

export interface GraphScan {
  kind: GraphKind;
  /** list / matrix: 0 … n−1; keyed: keys first seen first, then neighbors without a key of their own */
  nodes: NodeId[];
  /** every edge the structure ever held (with the first weight seen) */
  edges: GraphEdge[];
  /** inner lists / Sets / matrix rows */
  rows: Set<ObjId>;
  /** `[node, weight]` pairs inside the rows */
  items: Set<ObjId>;
  weighted: boolean;
  directed: boolean;
}

export const edgeKey = (from: NodeId, to: NodeId) => `${from}>${to}`;
const INDEX = /^(?:0|[1-9]\d*)$/;

export function numberOf(tl: Timeline, v: V | undefined): number | undefined {
  const p = primitive(tl, v);
  return typeof p.value === 'number' && !Number.isNaN(p.value) ? p.value : undefined;
}

/** The node a value names: integers and strings (null for anything else). */
export function nodeIdOf(tl: Timeline, v: V | undefined): NodeId | null {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : null;
  if (typeof v === 'string') return v;
  return isObj(v) && 's' in v ? tl.strings.get(v.s) ?? null : null;
}

const nullish = (v: V | undefined) => v === undefined || v === null || isUndef(v) || (isObj(v) && 'hole' in v);

function containerPairs(tl: Timeline, obj: HeapObj, kind: GraphKind): [NodeId | null, V][] | null {
  if (kind !== 'object') return obj.kind === 'array' ? (obj.elems?.toArray() ?? []).map((v, k) => [String(k), v]) : null;
  if (obj.kind === 'map') return orderedEntries(obj).map((e) => [nodeIdOf(tl, e.k), e.v]);
  return obj.kind === 'object' && !obj.cls ? orderedProps(obj).map(([k, slot]) => [k, slot.v]) : null;
}

/** Rows by index (list / matrix) or key (object / Map); null when the object is no such container. */
export function graphRows(tl: Timeline, snap: Snapshot, objId: ObjId, kind: GraphKind): Row[] | null {
  const obj = snap.heap.get(objId);
  const pairs = obj ? containerPairs(tl, obj, kind) : null;
  if (!pairs) return null;
  const out: Row[] = [];
  for (const [node, v] of pairs) {
    const id = refId(v);
    if (node === null || (id === null && !nullish(v))) return null;
    out.push({ node, id });
  }
  return out;
}

/** A list / Set row's entries (node ids, or `[node, weight]` pairs); null when some element is neither. */
export function listEntries(tl: Timeline, snap: Snapshot, row: HeapObj): Entry[] | null {
  const values = row.kind === 'set' ? orderedEntries(row).map((e) => e.v) : row.kind === 'array' ? row.elems?.toArray() ?? [] : null;
  if (!values) return null;
  const out: Entry[] = [];
  for (const v of values) {
    const to = nodeIdOf(tl, v);
    if (to !== null) {
      out.push({ to });
      continue;
    }
    const pair = deref(snap, v);
    const head = pair?.kind === 'array' ? nodeIdOf(tl, pair.elems?.get(0)) : null;
    if (!pair || head === null) return null;
    const weight = numberOf(tl, pair.elems?.get(1));
    out.push(weight === undefined ? { to: head, item: pair.id } : { to: head, weight, item: pair.id });
  }
  return out;
}

/** A matrix row's edges: every nonzero finite cell (true counts as 1); null when some cell is no number. */
export function matrixEntries(tl: Timeline, row: HeapObj): Entry[] | null {
  if (row.kind !== 'array') return null;
  const out: Entry[] = [];
  const cells = row.elems?.toArray() ?? [];
  for (let k = 0; k < cells.length; k++) {
    const p = primitive(tl, cells[k]);
    const w = typeof p.value === 'boolean' ? Number(p.value) : typeof p.value === 'number' ? p.value : NaN;
    if (Number.isNaN(w)) return null;
    if (w !== 0 && Number.isFinite(w)) out.push({ to: String(k), weight: w });
  }
  return out;
}

export function rowEntries(tl: Timeline, snap: Snapshot, kind: GraphKind, row: HeapObj): Entry[] | null {
  return kind === 'matrix' ? matrixEntries(tl, row) : listEntries(tl, snap, row);
}

const edgeOf = (from: NodeId, e: Entry): GraphEdge => (e.weight === undefined ? { from, to: e.to } : { from, to: e.to, weight: e.weight });

/** An edge list's `[u, v(, w)]` items at a snapshot; null when some item is no such pair / triple. */
export function edgeItems(tl: Timeline, snap: Snapshot, objId: ObjId): { edges: GraphEdge[]; items: ObjId[] } | null {
  const list = snap.heap.get(objId);
  if (list?.kind !== 'array') return null;
  const edges: GraphEdge[] = [];
  const items: ObjId[] = [];
  for (const v of list.elems?.toArray() ?? []) {
    const item = deref(snap, v);
    const elems = item?.kind === 'array' ? item.elems?.toArray() ?? [] : [];
    const [from, to] = [nodeIdOf(tl, elems[0]), nodeIdOf(tl, elems[1])];
    const weight = numberOf(tl, elems[2]);
    if (!item || from === null || to === null || elems.length < 2 || elems.length > 3 || (elems.length === 3 && weight === undefined)) return null;
    edges.push(weight === undefined ? { from, to } : { from, to, weight });
    items.push(item.id);
  }
  return { edges, items };
}

/** The structure's edges at a snapshot (null when it is no graph of this kind there). */
export function edgesAt(tl: Timeline, snap: Snapshot, objId: ObjId, kind: GraphKind): GraphEdge[] | null {
  if (kind === 'edges') return edgeItems(tl, snap, objId)?.edges ?? null;
  const rows = graphRows(tl, snap, objId, kind);
  if (!rows) return null;
  const out: GraphEdge[] = [];
  for (const r of rows) {
    const row = r.id === null ? undefined : snap.heap.get(r.id);
    if (!row) continue;
    const entries = rowEntries(tl, snap, kind, row);
    if (!entries) return null;
    for (const e of entries) out.push(edgeOf(r.node, e));
  }
  return out;
}

/** Some edge u → v (u ≠ v) has no v → u. */
export function isDirected(edges: readonly GraphEdge[]): boolean {
  const keys = new Set(edges.map((e) => edgeKey(e.from, e.to)));
  return edges.some((e) => e.from !== e.to && !keys.has(edgeKey(e.to, e.from)));
}

const scanCache: Cache<GraphScan | null> = new WeakMap();

export function scanGraph(tl: Timeline, objId: ObjId, kind: GraphKind): GraphScan | null {
  return cached(scanCache, tl, `${kind}:${objId}`, () => (kind === 'edges' ? scanEdges(tl, objId) : scan(tl, objId, kind)));
}

/** Steps whose heap changes touch one of `watch` (it grows as rows / items are found). */
function* changeSteps(tl: Timeline, watch: ReadonlySet<ObjId>): Generator<number> {
  for (let s = 0; s < tl.steps.length; s++) if (tl.diffs[s].heap.some((h) => watch.has(h.id))) yield s;
}

/** An edge list over the run: its items are the rows; integer ids name nodes 0 … max (unless far apart). */
function scanEdges(tl: Timeline, objId: ObjId): GraphScan | null {
  const watch = new Set<ObjId>([objId]);
  const items = new Set<ObjId>();
  const edges = new Map<string, GraphEdge>();
  const seen = new Set<NodeId>();
  for (const s of changeSteps(tl, watch)) {
    const found = edgeItems(tl, tl.snapshots[s], objId);
    if (!found) return null;
    for (const id of found.items) {
      items.add(id);
      watch.add(id);
    }
    for (const e of found.edges) {
      if (!edges.has(edgeKey(e.from, e.to))) edges.set(edgeKey(e.from, e.to), e);
      seen.add(e.from).add(e.to);
    }
  }
  const all = [...edges.values()];
  const ids = [...seen];
  const top = Math.max(...ids.map(Number));
  const dense = ids.every((id) => INDEX.test(id)) && top < 2 * ids.length;
  const nodes = dense ? Array.from({ length: top + 1 }, (_, k) => String(k)) : ids;
  if (all.length === 0 || nodes.length < 2) return null;
  return { kind: 'edges', nodes, edges: all, rows: items, items: new Set(), weighted: all.some((e) => e.weight !== undefined), directed: isDirected(all) };
}

/** Square and numeric at a snapshot: every row there, as long as there are rows. */
function squareAt(tl: Timeline, snap: Snapshot, objId: ObjId): boolean {
  const found = graphRows(tl, snap, objId, 'matrix');
  return Boolean(found?.length) && found!.every((r) => {
    const row = r.id === null ? undefined : snap.heap.get(r.id);
    return row?.kind === 'array' && row.elems?.size === found!.length && matrixEntries(tl, row) !== null;
  });
}

/** Replays the structure at every step that changed it, re-reading only the rows that (or whose pairs) changed. */
function scan(tl: Timeline, objId: ObjId, kind: GraphKind): GraphScan | null {
  // most nested arrays are no matrix: decided by the final state before replaying anything
  if (kind === 'matrix' && !squareAt(tl, tl.snapshots[tl.snapshots.length - 1], objId)) return null;
  const watch = new Set<ObjId>([objId]);
  const rows = new Set<ObjId>();
  const items = new Set<ObjId>();
  const rowOfItem = new Map<ObjId, ObjId>();
  const keys = new Set<NodeId>();
  const edges = new Map<string, GraphEdge>();
  let found: Row[] | null = null;
  let length = 0;
  for (const s of changeSteps(tl, watch)) {
    const snap = tl.snapshots[s];
    const touched = new Set(tl.diffs[s].heap.map((h) => rowOfItem.get(h.id) ?? h.id));
    // the outer object changed: rows may have moved, so all are read again
    const reread = !found || touched.has(objId);
    if (reread) found = graphRows(tl, snap, objId, kind);
    if (!found) return null;
    length = Math.max(length, found.length);
    for (const r of found) {
      keys.add(r.node);
      const row = r.id === null ? undefined : snap.heap.get(r.id);
      if (!row || r.id === null || (!reread && !touched.has(r.id))) continue;
      rows.add(r.id);
      watch.add(r.id);
      const entries = rowEntries(tl, snap, kind, row);
      if (!entries) return null;
      for (const e of entries) {
        if (e.item !== undefined) {
          items.add(e.item);
          watch.add(e.item);
          rowOfItem.set(e.item, r.id);
        }
        const key = edgeKey(r.node, e.to);
        if (!edges.has(key)) edges.set(key, edgeOf(r.node, e));
      }
    }
  }
  const all = [...edges.values()];
  const nodes = nodeOrder(kind, keys, all, length);
  if (!nodes || all.length === 0 || nodes.length < 2) return null;
  const weighted = kind === 'matrix' ? all.some((e) => e.weight !== 1) : all.some((e) => e.weight !== undefined);
  return { kind, nodes, edges: all, rows, items, weighted, directed: isDirected(all) };
}

/** Node ids in their stable order; null when the neighbors don't name nodes of this structure. */
function nodeOrder(kind: GraphKind, keys: Set<NodeId>, edges: GraphEdge[], length: number): NodeId[] | null {
  if (kind === 'object') {
    if (!edges.some((e) => keys.has(e.to))) return null;
    const out = [...keys];
    for (const e of edges) {
      if (keys.has(e.to)) continue;
      keys.add(e.to);
      out.push(e.to);
    }
    return out;
  }
  let n = length;
  for (const e of edges) {
    // neighbors are indexes of the outer list (a node without a list of its own may follow the last one)
    if (!INDEX.test(e.to) || Number(e.to) >= 2 * Math.max(1, length)) return null;
    n = Math.max(n, Number(e.to) + 1);
  }
  return Array.from({ length: n }, (_, k) => String(k));
}
