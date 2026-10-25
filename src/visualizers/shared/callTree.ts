/**
 * Call trees of a set of functions (a recursion and the functions it recurses through): how the calls
 * nest, what phase each call is in at a step, which calls fit the node budget, and a tidy
 * (Reingold–Tilford) layout. Shared by the recursion-tree, backtracking and memo visualizers.
 * Pure — no React, no WebGL.
 */
import { hierarchy, tree as tidyTree, type HierarchyPointNode } from 'd3-hierarchy';
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, refId } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';

export interface TreeNode {
  callId: number;
  /** nearest enclosing call of a tree function (null for roots) */
  parent: number | null;
  children: number[];
  fnId: number;
  depth: number;
  enterStep: number;
  returnStep?: number;
  exitStep?: number;
  value?: V;
  threw?: boolean;
  args: V[];
  /** calls in this subtree, itself included */
  size: number;
}

export interface CallTree {
  fnIds: number[];
  roots: number[];
  nodes: Map<number, TreeNode>;
}

/**
 * future: not called yet · active: the current call (or the tree call the current helper belongs to) ·
 * waiting: on the stack below the active call · returned / threw: finished.
 */
export type NodePhase = 'future' | 'active' | 'waiting' | 'returned' | 'threw';

const treeCache = new WeakMap<Timeline, Map<string, { calls: number; tree: CallTree }>>();

export function buildCallTree(tl: Timeline, fnIds: Iterable<number>): CallTree {
  const ids = [...new Set(fnIds)].sort((a, b) => a - b);
  const key = ids.join(',');
  let byKey = treeCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    treeCache.set(tl, byKey);
  }
  const hit = byKey.get(key);
  if (hit && hit.calls === tl.calls.size) return hit.tree;
  const set = new Set(ids);
  const nodes = new Map<number, TreeNode>();
  const roots: number[] = [];
  // calls are recorded in entry order, so a parent is always seen before its children
  for (const call of tl.calls.values()) {
    if (!set.has(call.fnId)) continue;
    let p = tl.calls.get(call.parentId);
    while (p && p.callId !== call.callId && !set.has(p.fnId)) p = tl.calls.get(p.parentId);
    const parent = p && p.callId !== call.callId ? nodes.get(p.callId) ?? null : null;
    const node: TreeNode = {
      callId: call.callId, parent: parent ? parent.callId : null, children: [], fnId: call.fnId,
      depth: parent ? parent.depth + 1 : 0, enterStep: call.enterStep, returnStep: call.returnStep, exitStep: call.exitStep,
      value: call.value, threw: call.threw, args: call.args, size: 1,
    };
    nodes.set(call.callId, node);
    if (parent) parent.children.push(call.callId);
    else roots.push(call.callId);
  }
  for (const n of [...nodes.values()].reverse()) if (n.parent !== null) nodes.get(n.parent)!.size += n.size;
  const tree = { fnIds: ids, roots, nodes };
  byKey.set(key, { calls: tl.calls.size, tree });
  return tree;
}

/** The tree call the step belongs to: its own frame, or the nearest tree call below a helper's frame. */
export function activeNode(tl: Timeline, tree: CallTree, i: number): number | null {
  let call = tl.calls.get(tl.steps[i]?.callId ?? -1);
  while (call && !tree.nodes.has(call.callId)) call = tl.calls.get(call.parentId);
  if (!call) return null;
  // the frame is gone once it exited (e.g. the step after a return lands back in the caller)
  const node = tree.nodes.get(call.callId)!;
  return node.exitStep !== undefined && node.exitStep <= i ? node.parent : node.callId;
}

export function phaseAt(node: TreeNode, i: number, activeId: number | null): NodePhase {
  if (node.enterStep > i) return 'future';
  if (node.callId === activeId) return 'active';
  if (node.exitStep !== undefined && node.exitStep <= i) return node.threw ? 'threw' : 'returned';
  return 'waiting';
}

/** The return value is known from the return step on (while the frame is still on the stack). */
export const hasReturned = (node: TreeNode, i: number) => node.returnStep !== undefined && node.returnStep <= i && !node.threw;

/** Calls from the root down to `id`. */
export function pathTo(tree: CallTree, id: number | null): number[] {
  const out: number[] = [];
  for (let n = id === null ? undefined : tree.nodes.get(id); n; n = n.parent === null ? undefined : tree.nodes.get(n.parent)) out.push(n.callId);
  return out.reverse();
}

export interface DisplaySet {
  ids: Set<number>;
  /** shown call → number of calls hidden below it */
  hidden: Map<number, number>;
}

/**
 * At most `cap` calls: the shallowest levels that fit, every expanded subtree (breadth-first, within a
 * second budget) and always the path to the active call, so the current position is never hidden.
 */
export function displaySet(tree: CallTree, cap: number, activeId: number | null, expanded: ReadonlySet<number> = new Set()): DisplaySet {
  const ids = new Set<number>();
  if (tree.nodes.size <= cap) {
    for (const id of tree.nodes.keys()) ids.add(id);
    return { ids, hidden: new Map() };
  }
  const perDepth: number[] = [];
  for (const n of tree.nodes.values()) perDepth[n.depth] = (perDepth[n.depth] ?? 0) + 1;
  let maxDepth = -1;
  for (let d = 0, total = 0; d < perDepth.length && total + perDepth[d] <= cap; d++) {
    total += perDepth[d];
    maxDepth = d;
  }
  for (const n of tree.nodes.values()) if (n.depth <= maxDepth) ids.add(n.callId);
  let budget = cap;
  for (const root of expanded) {
    const queue = [root];
    while (queue.length && budget > 0) {
      const n = tree.nodes.get(queue.shift()!);
      if (!n) continue;
      if (!ids.has(n.callId)) {
        ids.add(n.callId);
        budget -= 1;
      }
      queue.push(...n.children);
    }
  }
  for (const id of pathTo(tree, activeId)) ids.add(id);
  const hidden = new Map<number, number>();
  for (const id of ids) {
    let count = 0;
    for (const c of tree.nodes.get(id)!.children) if (!ids.has(c)) count += tree.nodes.get(c)!.size;
    if (count) hidden.set(id, count);
  }
  return { ids, hidden };
}

export interface TreeLayout {
  /** node center: x (centered on 0), y (root on top, deepest level at `bottom`) */
  pos: Map<number, [number, number]>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** vertical distance between levels */
  dy?: number;
  /** horizontal space between neighboring nodes */
  gap?: number;
  /** width of a node (default 1) — wide nodes (mini-arrays) push their neighbors apart */
  widthOf?(node: TreeNode): number;
  /** y of the deepest level */
  bottom?: number;
}

interface Datum {
  id: number;
  children: Datum[];
}

export function layoutTree(tree: CallTree, ids: ReadonlySet<number>, opts: LayoutOptions = {}): TreeLayout {
  const dy = opts.dy ?? 1.6;
  const gap = opts.gap ?? 0.35;
  const bottom = opts.bottom ?? 0.5;
  const widthOf = (id: number) => (id < 0 ? 0 : opts.widthOf?.(tree.nodes.get(id)!) ?? 1);
  const datum = (id: number): Datum => ({ id, children: tree.nodes.get(id)!.children.filter((c) => ids.has(c)).map(datum) });
  const root: Datum = { id: -1, children: tree.roots.filter((r) => ids.has(r)).map(datum) };
  const pos = new Map<number, [number, number]>();
  if (!root.children.length) return { pos, width: 0, height: 0 };
  const laid = tidyTree<Datum>()
    .nodeSize([1, dy])
    .separation((a, b) => (widthOf(a.data.id) + widthOf(b.data.id)) / 2 + gap * (a.parent === b.parent ? 1 : 1.6))(hierarchy(root));
  let minX = Infinity;
  let maxX = -Infinity;
  let maxDepth = 0;
  laid.each((n: HierarchyPointNode<Datum>) => {
    if (n.data.id < 0) return;
    const half = widthOf(n.data.id) / 2;
    minX = Math.min(minX, n.x - half);
    maxX = Math.max(maxX, n.x + half);
    maxDepth = Math.max(maxDepth, n.depth);
  });
  const mid = (minX + maxX) / 2;
  laid.each((n: HierarchyPointNode<Datum>) => {
    if (n.data.id >= 0) pos.set(n.data.id, [n.x - mid, bottom + (maxDepth - n.depth) * dy]);
  });
  return { pos, width: maxX - minX, height: bottom + (maxDepth - 1) * dy };
}

/** Argument positions that hold the same object in every call (shown by parameter name, e.g. `arr`). */
export function constantArgs(tree: CallTree): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const fnId of tree.fnIds) {
    const calls = [...tree.nodes.values()].filter((n) => n.fnId === fnId);
    const same = new Set<number>();
    const arity = Math.max(0, ...calls.map((c) => c.args.length));
    for (let k = 0; k < arity; k++) {
      const first = refId(calls[0]?.args[k]);
      if (first !== null && calls.length > 1 && calls.every((c) => refId(c.args[k]) === first)) same.add(k);
    }
    out.set(fnId, same);
  }
  return out;
}

/** `fib(3)`, `quickSort(arr, 0, 3)` — compact enough for a node label. */
export function callText(tl: Timeline, snap: Snapshot, node: TreeNode, constant: ReadonlySet<number> = new Set()): string {
  const fn = tl.meta.fns[node.fnId];
  const args = node.args.map((v, k) => (constant.has(k) ? fn?.params[k] ?? '…' : previewValue(tl, snap, v, { depth: 0, maxString: 8 })));
  return `${fn?.name ?? 'call'}(${args.join(', ')})`;
}
