/**
 * The traversal at one step (pure): the node being expanded, the edge being examined (only while the
 * neighbor loop runs in the topmost traversal call), the visited nodes (the visited structure, else calls
 * started on a node, else nodes reached / expanded so far), the frontier and the distances.
 */
import { trackVar, valueAt, type VarRef } from '../../engine/detect/track';
import { orderedEntries, orderedProps } from '../../engine/timeline/heap';
import { isVisible } from '../../engine/timeline/scope';
import type { FrameSnap, HeapObj, Timeline, VarSlot } from '../../engine/timeline/types';
import { deref, isObj } from '../../engine/timeline/values';
import { isUndef, sameV, type ObjId, type V } from '../../engine/types/values';
import { cached, type Cache } from '../dp1d/table';
import type { GraphBindings } from './detect';
import { itemNode } from './roles';
import { nodeIdOf, numberOf, type NodeId } from './structure';

/** A binding's slot in a frame: the one in scope, else (`inScope` false) the latest one the frame holds. */
function slotIn(tl: Timeline, f: FrameSnap, ref: VarRef, inScope: boolean): VarSlot | undefined {
  let held: VarSlot | undefined;
  let visible: VarSlot | undefined;
  for (const bid of ref.bids) {
    const slot = f.vars.get(bid);
    if (!slot) continue;
    if (!held || slot.ord > held.ord) held = slot;
    if ((!visible || slot.ord > visible.ord) && isVisible(tl, f, bid, slot)) visible = slot;
  }
  return inScope ? visible : visible ?? held;
}

/** The variable in the topmost running call of its function; undefined when no running call holds it. */
export function liveValue(tl: Timeline, ref: VarRef, i: number): V | undefined {
  const frames = tl.snapshots[i]?.frames;
  if (!frames) return undefined;
  for (let k = frames.size - 1; k >= 0; k--) {
    const f = frames.get(k) as FrameSnap;
    if (f.fnId === ref.fnId) return slotIn(tl, f, ref, false)?.v;
  }
  return undefined;
}

const nodeSets = new WeakMap<GraphBindings, ReadonlySet<NodeId>>();

function nodeSet(b: GraphBindings): ReadonlySet<NodeId> {
  let set = nodeSets.get(b);
  if (!set) nodeSets.set(b, (set = new Set(b.nodes.map((n) => n.id))));
  return set;
}

function asNode(tl: Timeline, b: GraphBindings, v: V | undefined): NodeId | null {
  const id = nodeIdOf(tl, v);
  return id !== null && nodeSet(b).has(id) ? id : null;
}

export function currentAt(tl: Timeline, b: GraphBindings, i: number): NodeId | null {
  return b.current ? asNode(tl, b, liveValue(tl, b.current, i)) : null;
}

/** The loop's last check (`for … of` running out): nothing is examined any more. */
function leavingLoop(tl: Timeline, b: GraphBindings, i: number, callId: number): boolean {
  const ev = tl.steps[i]?.ev;
  return ev?.t === 'cond' && ev.kind === 'loop' && !ev.result && ev.loop?.loopId === b.walkLoop && ev.callId === callId;
}

/** current → neighbor while the neighbor loop runs in the topmost traversal call (a deeper call has its own). */
export function examinedAt(tl: Timeline, b: GraphBindings, i: number): { from: NodeId; to: NodeId } | null {
  const { current, neighbor } = b;
  const frames = tl.snapshots[i]?.frames;
  if (!current || !neighbor || !frames) return null;
  const fns = new Set([...b.traversalFns, neighbor.fnId, current.fnId]);
  for (let k = frames.size - 1; k >= 0; k--) {
    const f = frames.get(k) as FrameSnap;
    if (!fns.has(f.fnId)) continue;
    if (f.fnId !== neighbor.fnId || leavingLoop(tl, b, i, f.callId)) return null;
    const to = asNode(tl, b, slotIn(tl, f, neighbor, true)?.v);
    // the neighbor loop's own frame, or (a forEach callback) the call below it holding the current node
    let from: NodeId | null = null;
    for (let c = k; c >= 0 && from === null; c--) {
      const cf = frames.get(c) as FrameSnap;
      if (cf.fnId === current.fnId) from = asNode(tl, b, slotIn(tl, cf, current, false)?.v);
    }
    return to !== null && from !== null ? { from, to } : null;
  }
  return null;
}

const nullish = (v: V | undefined) => v === undefined || v === null || v === false || isUndef(v) || (isObj(v) && 'hole' in v);

const initialCache: Cache<V | undefined> = new WeakMap();

/** The value an array's cells start with (after its creation and any fill before the first write), by majority. */
function initialOf(tl: Timeline, id: ObjId): V | undefined {
  return cached(initialCache, tl, String(id), () => {
    let elems: V[] = [];
    for (let s = 0; s < tl.diffs.length; s++) {
      const mine = tl.diffs[s].heap.filter((h) => h.id === id);
      if (!mine.length) continue;
      if (mine.some((h) => h.op === 'set')) break;
      elems = tl.snapshots[s].heap.get(id)?.elems?.toArray() ?? [];
    }
    const counts = new Map<string, { v: V; n: number }>();
    for (const v of elems) {
      const key = JSON.stringify(v);
      counts.set(key, { v, n: (counts.get(key)?.n ?? 0) + 1 });
    }
    return [...counts.values()].sort((x, y) => y.n - x.n)[0]?.v;
  });
}

/** Nodes marked in a visited structure: Set members, Map / object keys (not set to false), array cells changed from their start. */
export function marksOf(tl: Timeline, obj: HeapObj | undefined, nodes: ReadonlySet<NodeId>): Set<NodeId> {
  const out = new Set<NodeId>();
  const add = (id: NodeId | null) => id !== null && nodes.has(id) && out.add(id);
  if (obj?.kind === 'set') for (const e of orderedEntries(obj)) add(nodeIdOf(tl, e.v));
  else if (obj?.kind === 'map') for (const e of orderedEntries(obj)) add(e.v === false ? null : nodeIdOf(tl, e.k));
  else if (obj?.kind === 'object') for (const [k, slot] of orderedProps(obj)) add(slot.v === false ? null : k);
  else if (obj?.kind === 'array') {
    const initial = initialOf(tl, obj.id);
    (obj.elems?.toArray() ?? []).forEach((v, k) => {
      if (!nullish(v) && !(initial !== undefined && sameV(v, initial))) add(String(k));
    });
  }
  return out;
}

/** Numbers by node in an array / Map / plain object. */
export function numbersOf(tl: Timeline, obj: HeapObj | undefined): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  const put = (id: NodeId | null, v: V | undefined) => {
    const n = numberOf(tl, v);
    if (id !== null && n !== undefined) out.set(id, n);
  };
  if (obj?.kind === 'array') (obj.elems?.toArray() ?? []).forEach((v, k) => put(String(k), v));
  else if (obj?.kind === 'map') for (const e of orderedEntries(obj)) put(nodeIdOf(tl, e.k), e.v);
  else if (obj?.kind === 'object') for (const [k, slot] of orderedProps(obj)) put(k, slot.v);
  return out;
}

export function distAt(tl: Timeline, b: GraphBindings, i: number): Map<NodeId, number> {
  return b.dist ? numbersOf(tl, deref(tl.snapshots[i], valueAt(tl, b.dist, i))) : new Map();
}

/** The frontier's nodes at step i (a head-index queue drops the items before `head`). */
export function frontierAt(tl: Timeline, b: GraphBindings, i: number): Set<NodeId> {
  const shape = b.frontierShape;
  const snap = tl.snapshots[i];
  if (!b.frontier || !shape || !snap) return new Set();
  let obj = deref(snap, valueAt(tl, b.frontier, i));
  if (shape.prop) obj = deref(snap, obj?.props?.get(shape.prop)?.v);
  if (obj?.kind !== 'array') return new Set();
  const head = shape.head ? numberOf(tl, valueAt(tl, shape.head, i)) ?? 0 : 0;
  const nodes = nodeSet(b);
  const out = new Set<NodeId>();
  for (const v of (obj.elems?.toArray() ?? []).slice(Math.max(0, head))) {
    const id = itemNode(tl, snap, v, nodes, shape.slot);
    if (id !== null) out.add(id);
  }
  return out;
}

/** Index of the current variable among its function's parameters (-1: a local). */
function currentParam(tl: Timeline, b: GraphBindings): number {
  return b.current ? tl.meta.fns[b.current.fnId]?.params.indexOf(b.current.name) ?? -1 : -1;
}

export type VisitSource = 'marks' | 'calls' | 'distances' | 'expanded';

/** Where visited-ness comes from: the visited structure, calls on a node, reached distances, or nodes expanded so far. */
export function visitSource(tl: Timeline, b: GraphBindings): VisitSource {
  if (b.visited) return 'marks';
  if (currentParam(tl, b) >= 0) return 'calls';
  return b.dist ? 'distances' : 'expanded';
}

/** Visited nodes at step i, read from the structures (sources 'calls' / 'expanded' go by first visits). */
function readVisited(tl: Timeline, b: GraphBindings, i: number, nodes: ReadonlySet<NodeId>): Set<NodeId> {
  if (b.visited) return marksOf(tl, deref(tl.snapshots[i], valueAt(tl, b.visited, i)), nodes);
  return new Set([...distAt(tl, b, i)].filter(([id, d]) => nodes.has(id) && Number.isFinite(d)).map(([id]) => id));
}

const visitCache: Cache<Map<NodeId, number>> = new WeakMap();

/** The step each node was first visited. */
export function firstVisits(tl: Timeline, b: GraphBindings): Map<NodeId, number> {
  return cached(visitCache, tl, `${b.objId}:${b.visited?.name ?? ''}`, () => {
    const out = new Map<NodeId, number>();
    const note = (id: NodeId | null, i: number) => id !== null && !out.has(id) && out.set(id, i);
    const source = visitSource(tl, b);
    const { current } = b;
    if (source === 'calls' && current) {
      const k = currentParam(tl, b);
      for (const call of tl.calls.values()) if (call.fnId === current.fnId) note(asNode(tl, b, call.args[k]), call.enterStep);
    } else if (source === 'expanded' && current) {
      trackVar(tl, current).forEach((v, i) => note(asNode(tl, b, v), i));
    } else {
      const nodes = nodeSet(b);
      for (let i = 0; i < tl.steps.length; i++) {
        const d = tl.diffs[i];
        // nothing a structure could hold changed
        if (i > 0 && !d.heap.length && !d.vars.length) continue;
        for (const id of readVisited(tl, b, i, nodes)) note(id, i);
      }
    }
    return out;
  });
}

const expandCache: Cache<Map<NodeId, number[]>> = new WeakMap();

/** Steps at which the current variable was assigned each node. */
export function expansions(tl: Timeline, b: GraphBindings): Map<NodeId, number[]> {
  return cached(expandCache, tl, `${b.objId}:${b.current?.name ?? ''}`, () => {
    const out = new Map<NodeId, number[]>();
    tl.diffs.forEach((d, s) => {
      const c = d.vars.find((x) => b.current?.bids.includes(x.bid));
      const id = c ? asNode(tl, b, c.value) : null;
      if (id !== null) out.set(id, [...(out.get(id) ?? []), s]);
    });
    return out;
  });
}

export function visitedAt(tl: Timeline, b: GraphBindings, i: number): Set<NodeId> {
  const source = visitSource(tl, b);
  if (source === 'marks' || source === 'distances') return readVisited(tl, b, i, nodeSet(b));
  return new Set([...firstVisits(tl, b)].filter(([, s]) => s <= i).map(([id]) => id));
}
