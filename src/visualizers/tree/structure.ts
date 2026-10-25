/**
 * Tree links over the whole run (pure): a node's children at a step, the links a step writes, and the
 * stable forest the view lays out — the largest tree any step builds, then the largest one among the
 * remaining nodes, and so on — placed with d3-hierarchy's tidy tree. A binary node with one child keeps an
 * invisible stand-in for the missing one, so left children stay left and right children right.
 */
import { hierarchy, tree as tidyTree, type HierarchyPointNode } from 'd3-hierarchy';
import type { HeapChange, Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { TreeBindings } from './detect';

export type Vec2 = [number, number];
/** binary: [left, right] (null: no node there) · n-ary: the child nodes in order */
export type Kids = readonly (ObjId | null)[];

export const isBinary = (b: Pick<TreeBindings, 'childKeys'>) => !b.childKeys.includes('children');

const nodeOf = (v: V | undefined, nodes: ReadonlySet<ObjId>): ObjId | null => {
  const id = refId(v);
  return id !== null && nodes.has(id) ? id : null;
};

/** The node's value as drawn (`5`, `'ab'`): '' before it is set, '•' for nodes without a value property. */
export function nodeLabel(tl: Timeline, snap: Snapshot, b: TreeBindings, id: ObjId): string {
  if (!b.valueKey) return '•';
  const slot = snap.heap.get(id)?.props?.get(b.valueKey);
  return slot ? previewValue(tl, snap, slot.v, { depth: 0, maxString: 6 }) : '';
}

/** The array holding an n-ary node's children at a step. */
export function childArray(snap: Snapshot, b: TreeBindings, id: ObjId): ObjId | null {
  return isBinary(b) ? null : refId(snap.heap.get(id)?.props?.get(b.childKeys[0])?.v);
}

export function childrenAt(snap: Snapshot, b: TreeBindings, id: ObjId, nodes: ReadonlySet<ObjId>): Kids {
  if (isBinary(b)) return b.childKeys.map((k) => nodeOf(snap.heap.get(id)?.props?.get(k)?.v, nodes));
  const arr = childArray(snap, b, id);
  const elems = arr === null ? undefined : snap.heap.get(arr)?.elems;
  return elems ? elems.toArray().map((v) => nodeOf(v, nodes)).filter((k) => k !== null) : [];
}

export interface LinkChange {
  parent: ObjId;
  /** binary: index into the child keys (0 left, 1 right) · n-ary: -1 */
  slot: number;
  now: ObjId | null;
  was: ObjId | null;
}

/** Elements a change adds to / takes out of an array. */
const addedBy = (h: HeapChange): V[] => (h.op === 'push' || h.op === 'unshift' || h.op === 'splice' ? h.args ?? [] : h.op === 'set' && h.value !== undefined ? [h.value] : []);
const removedBy = (h: HeapChange): V[] => (h.op === 'splice' ? h.removed ?? [] : (h.op === 'shift' || h.op === 'pop' || h.op === 'set') && h.old !== undefined ? [h.old] : []);

/**
 * Links written by a step's heap changes, read against that step's snapshot. Writing a child back where it
 * already was (BST insertion does on its way back up) is no change.
 */
export function linkChanges(snap: Snapshot, heap: readonly HeapChange[], b: TreeBindings, nodes: ReadonlySet<ObjId>): LinkChange[] {
  const out: LinkChange[] = [];
  if (isBinary(b)) {
    for (const h of heap) {
      const slot = h.op === 'set' && nodes.has(h.id) ? b.childKeys.indexOf(String(h.path[0])) : -1;
      const now = nodeOf(h.value, nodes);
      const was = nodeOf(h.old, nodes);
      if (slot >= 0 && now !== was) out.push({ parent: h.id, slot, now, was });
    }
    return out;
  }
  if (!heap.some((h) => !nodes.has(h.id) || h.path[0] === b.childKeys[0])) return out;
  const owner = new Map<ObjId, ObjId>();
  for (const id of nodes) {
    const arr = childArray(snap, b, id);
    if (arr !== null) owner.set(arr, id);
  }
  const push = (parent: ObjId, now: ObjId | null, was: ObjId | null) => {
    if (now !== was) out.push({ parent, slot: -1, now, was });
  };
  for (const h of heap) {
    if (nodes.has(h.id) && h.op === 'set' && h.path[0] === b.childKeys[0]) {
      // a whole new children array: each node in it is a new child
      const arr = refId(h.value);
      for (const v of arr === null ? [] : snap.heap.get(arr)?.elems ?? []) push(h.id, nodeOf(v, nodes), null);
      continue;
    }
    const parent = owner.get(h.id);
    if (parent === undefined) continue;
    for (const v of removedBy(h)) push(parent, null, nodeOf(v, nodes));
    for (const v of addedBy(h)) push(parent, nodeOf(v, nodes), null);
  }
  return out;
}

interface Built {
  root: ObjId;
  kids: Map<ObjId, Kids>;
}

/** The tree under `root` (each node once, even when linked twice). */
function collect(root: ObjId, kids: ReadonlyMap<ObjId, Kids>): Built {
  const out = new Map<ObjId, Kids>();
  const stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    const ks = kids.get(id) ?? [];
    out.set(id, ks);
    for (const k of ks) if (k !== null && !out.has(k)) stack.push(k);
  }
  return { root, kids: out };
}

const sameKids = (a: Kids | undefined, b: Kids) => a !== undefined && a.length === b.length && a.every((k, j) => k === b[j]);

/** The largest tree any step builds out of the nodes outside `skip` (ties: the earliest). */
function largestTree(tl: Timeline, b: TreeBindings, skip: ReadonlySet<ObjId>): Built | null {
  const live = new Set(b.nodeIds.filter((id) => !skip.has(id)));
  const kids = new Map<ObjId, Kids>();
  // children array → the node holding it (n-ary trees)
  const owner = new Map<ObjId, ObjId>();
  let best: Built | null = null;
  for (let i = 0; i < tl.diffs.length; i++) {
    const touched = new Set<ObjId>();
    for (const h of tl.diffs[i].heap) {
      if (live.has(h.id)) touched.add(h.id);
      const o = owner.get(h.id);
      if (o !== undefined) touched.add(o);
    }
    const snap = tl.snapshots[i];
    let changed = false;
    for (const id of touched) {
      if (!snap.heap.has(id)) continue;
      const arr = childArray(snap, b, id);
      if (arr !== null) owner.set(arr, id);
      const next = childrenAt(snap, b, id, live);
      if (sameKids(kids.get(id), next)) continue;
      kids.set(id, next);
      changed = true;
    }
    if (!changed) continue;
    const linked = new Set<ObjId>();
    for (const ks of kids.values()) for (const k of ks) if (k !== null) linked.add(k);
    for (const root of kids.keys()) {
      if (linked.has(root)) continue;
      const t = collect(root, kids);
      if (!best || t.kids.size > best.kids.size) best = t;
    }
  }
  return best;
}

export interface Forest {
  /** tree roots: the largest tree first, then the next largest among the remaining nodes, …, then lone nodes */
  roots: ObjId[];
  kids: Map<ObjId, Kids>;
}

/** extra passes for trees left out by the larger ones (a copy beside the original, a detached subtree) */
const MAX_PASSES = 6;

export function buildForest(tl: Timeline, b: TreeBindings): Forest {
  const kids = new Map<ObjId, Kids>();
  const roots: ObjId[] = [];
  for (let pass = 0; pass < MAX_PASSES && kids.size < b.nodeIds.length; pass++) {
    const t = largestTree(tl, b, new Set(kids.keys()));
    if (!t || t.kids.size < 2) break;
    roots.push(t.root);
    for (const [id, ks] of t.kids) kids.set(id, ks);
  }
  for (const id of b.nodeIds) {
    if (kids.has(id)) continue;
    roots.push(id);
    kids.set(id, []);
  }
  return { roots, kids };
}

export interface ForestLayout {
  /** node centers: x centered on 0, y = 0 on the deepest level and `dy` higher per level up */
  pos: Map<ObjId, Vec2>;
  width: number;
  levels: number;
  /** nodes over the budget, left out */
  hidden: number;
}

/** horizontal room per node, per missing-child stand-in, and between neighbors (cousins get more) */
const NODE_W = 1;
const STAND_IN_W = 0.6;
const GAP = 0.32;

interface Datum {
  /** null: the root above all trees, or a missing binary child's stand-in */
  id: ObjId | null;
  w: number;
  children: Datum[];
}

/** At most `cap` nodes: the shallowest levels of all trees first. */
function budget(forest: Forest, cap: number): Set<ObjId> {
  const kept = new Set<ObjId>();
  const queue = [...forest.roots];
  for (let k = 0; k < queue.length && kept.size < cap; k++) {
    const id = queue[k];
    if (kept.has(id)) continue;
    kept.add(id);
    for (const c of forest.kids.get(id) ?? []) if (c !== null) queue.push(c);
  }
  return kept;
}

export function layoutForest(forest: Forest, binary: boolean, cap: number, dy: number): ForestLayout {
  const kept = budget(forest, cap);
  const seen = new Set<ObjId>();
  const standIn = (): Datum => ({ id: null, w: STAND_IN_W, children: [] });
  function datum(id: ObjId): Datum {
    seen.add(id);
    const ks = forest.kids.get(id) ?? [];
    if (!binary) return { id, w: NODE_W, children: ks.map(child).filter((d) => d !== null) };
    const left = child(ks[0]);
    const right = child(ks[1]);
    return { id, w: NODE_W, children: left || right ? [left ?? standIn(), right ?? standIn()] : [] };
  }
  /** a kept node not placed yet (one linked twice is placed once) */
  function child(k: ObjId | null | undefined): Datum | null {
    return k !== null && k !== undefined && kept.has(k) && !seen.has(k) ? datum(k) : null;
  }
  const top: Datum = { id: null, w: 0, children: forest.roots.map(child).filter((d) => d !== null) };
  const pos = new Map<ObjId, Vec2>();
  if (!top.children.length) return { pos, width: 0, levels: 0, hidden: forest.kids.size };
  const laid = tidyTree<Datum>()
    .nodeSize([1, dy])
    .separation((a, b) => (a.data.w + b.data.w) / 2 + GAP * (a.parent === b.parent ? 1 : 1.5))(hierarchy(top));
  let minX = Infinity;
  let maxX = -Infinity;
  let levels = 0;
  laid.each((n: HierarchyPointNode<Datum>) => {
    if (n.data.id === null) return;
    minX = Math.min(minX, n.x - n.data.w / 2);
    maxX = Math.max(maxX, n.x + n.data.w / 2);
    levels = Math.max(levels, n.depth);
  });
  const mid = (minX + maxX) / 2;
  laid.each((n: HierarchyPointNode<Datum>) => {
    if (n.data.id !== null) pos.set(n.data.id, [n.x - mid, (levels - n.depth) * dy]);
  });
  return { pos, width: maxX - minX, levels, hidden: forest.kids.size - kept.size };
}
