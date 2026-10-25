/**
 * Trees: plain objects or class instances whose `left` / `right` (binary) or `children` array (n-ary) refer
 * to other objects of the same shape — the same class, or the same property names — with at least one link
 * between two of them at some step. Also found: the value a node shows, the variable naming the root, the
 * pointer variables (the node class's own constructor only wires a new node up, so its parameters are left
 * out), the recursive functions walking the nodes (their calls take a node) and the visit-order arrays.
 */
import type { VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import { orderedProps } from '../../engine/timeline/heap';
import { refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { DetectContext, Detection } from '../types';
import { findOutputs, isNodeCtor, nodeArgPositions } from './walk';

export interface OutputBinding {
  objId: ObjId;
  /** the variable holding the array */
  ref: VarRef;
}

export interface TreeBindings {
  /** class name, or the property names of plain-object nodes (`{val}`) */
  nodeShape: string;
  /** property shown in the node (absent when nodes carry nothing else) */
  valueKey?: string;
  /** `['left', 'right']` (binary) or `['children']` (n-ary: an array of nodes) */
  childKeys: string[];
  /** every node, in allocation order */
  nodeIds: ObjId[];
  /** the variable naming the root (root, tree, …), else the object holding it (a BST class instance) */
  rootVar?: VarRef;
  /** variables holding a node at some step, by first appearance */
  pointers: VarRef[];
  /** recursive functions whose calls take a node (insert, inorder, maxDepth, …) */
  traversalFns: number[];
  /** the array the (first) visit order is pushed to (`out`, `result`) */
  output?: VarRef;
  /** every visit-order array by first visit: each traversal may fill its own */
  outputs: OutputBinding[];
}

const BINARY_KEYS = ['left', 'right'];
const CHILDREN_KEY = 'children';
const VALUE_KEYS = ['val', 'value', 'key', 'data'];
const LINK_KEYS = new Set([...BINARY_KEYS, CHILDREN_KEY, 'parent']);
/** root variables, best first */
const ROOT_HINTS = [/^root$/i, /root/i, /^tree$/i, /tree/i];

interface ObjFacts {
  id: ObjId;
  cls?: string;
  /** own property names, first seen first */
  props: string[];
  /** property → objects it referred to at some step */
  refs: Map<string, Set<ObjId>>;
}

interface HeapFacts {
  objects: Map<ObjId, ObjFacts>;
  /** array → objects its elements referred to at some step */
  elems: Map<ObjId, Set<ObjId>>;
}

/** Property names and referenced objects of every plain object / class instance, and what arrays held. */
function scanHeap({ tl, analysis }: DetectContext): HeapFacts {
  const objects = new Map<ObjId, ObjFacts>();
  const elems = new Map<ObjId, Set<ObjId>>();
  const noteRef = <K>(into: Map<K, Set<ObjId>>, key: K, v: V | undefined) => {
    const target = refId(v);
    if (target !== null) into.set(key, (into.get(key) ?? new Set<ObjId>()).add(target));
  };
  const noteProp = (f: ObjFacts, key: string, v: V | undefined) => {
    if (!f.props.includes(key)) f.props.push(key);
    noteRef(f.refs, key, v);
  };
  tl.diffs.forEach((d, i) => {
    for (const h of d.heap) {
      const info = analysis.objects.get(h.id);
      if (info?.kind === 'array') {
        const added = h.op === 'alloc' ? tl.snapshots[i].heap.get(h.id)?.elems?.toArray() ?? [] : [...(h.args ?? []), ...(h.after ?? []), h.value];
        for (const v of added) noteRef(elems, h.id, v);
        continue;
      }
      if (info?.kind !== 'object') continue;
      let f = objects.get(h.id);
      if (!f) {
        f = { id: h.id, cls: info.cls, props: [], refs: new Map() };
        objects.set(h.id, f);
      }
      if (h.op === 'alloc') {
        const obj = tl.snapshots[i].heap.get(h.id);
        if (obj) for (const [k, slot] of orderedProps(obj)) noteProp(f, k, slot.v);
      } else if (h.op === 'set' && typeof h.path[0] === 'string') noteProp(f, h.path[0], h.value);
    }
  });
  return { objects, elems };
}

/** Same class, or (plain objects) the same non-link property names. */
const shapeOf = (f: ObjFacts) => f.cls ?? `{${f.props.filter((k) => !LINK_KEYS.has(k)).sort().join(',')}}`;

interface NodeGroup {
  shape: string;
  cls?: string;
  members: ObjFacts[];
}

function groupByShape(objects: Map<ObjId, ObjFacts>): NodeGroup[] {
  const groups = new Map<string, NodeGroup>();
  for (const f of objects.values()) {
    const shape = shapeOf(f);
    const g = groups.get(shape) ?? { shape, cls: f.cls, members: [] };
    g.members.push(f);
    groups.set(shape, g);
  }
  return [...groups.values()];
}

/** Objects a member referred to through its child keys at some step. */
function childTargets(f: ObjFacts, binary: boolean, elems: HeapFacts['elems']): ObjId[] {
  if (binary) return BINARY_KEYS.flatMap((k) => [...(f.refs.get(k) ?? [])]);
  return [...(f.refs.get(CHILDREN_KEY) ?? [])].flatMap((arr) => [...(elems.get(arr) ?? [])]);
}

/** Members with a child key or referred to by one; null unless two different members get linked. */
function treeNodes(g: NodeGroup, binary: boolean, elems: HeapFacts['elems']): Set<ObjId> | null {
  const ids = new Set(g.members.map((f) => f.id));
  const keys = binary ? BINARY_KEYS : [CHILDREN_KEY];
  const nodes = new Set<ObjId>();
  let linked = false;
  for (const f of g.members) {
    if (keys.some((k) => f.props.includes(k))) nodes.add(f.id);
    for (const t of childTargets(f, binary, elems)) {
      if (!ids.has(t)) continue;
      nodes.add(t);
      if (t !== f.id) linked = true;
    }
  }
  return linked ? nodes : null;
}

const byFirstStep = (x: VarInfo, y: VarInfo) => x.firstStep - y.firstStep;

function pointerVars(ctx: DetectContext, nodes: Set<ObjId>, cls: string | undefined): VarInfo[] {
  return [...ctx.analysis.vars.values()]
    .filter((v) => !v.kinds.has('fn') && [...v.heapIds].some((id) => nodes.has(id)) && !isNodeCtor(ctx.tl, v.ref.fnId, cls))
    .sort(byFirstStep);
}

/** Variables holding an object that refers to a node (a tree class keeping `root`). */
function holderVars({ analysis }: DetectContext, objects: Map<ObjId, ObjFacts>, nodes: Set<ObjId>): VarInfo[] {
  const holders = new Set<ObjId>();
  for (const f of objects.values()) {
    if (nodes.has(f.id)) continue;
    for (const targets of f.refs.values()) if ([...targets].some((t) => nodes.has(t))) holders.add(f.id);
  }
  return [...analysis.vars.values()].filter((v) => !v.kinds.has('fn') && [...v.heapIds].some((id) => holders.has(id))).sort(byFirstStep);
}

function rootVarOf(pointers: VarInfo[], holders: VarInfo[]): VarInfo | undefined {
  for (const hint of ROOT_HINTS) {
    const hit = pointers.find((p) => hint.test(p.ref.name));
    if (hit) return hit;
  }
  return holders[0] ?? pointers.find((p) => p.ref.fnId === 0) ?? pointers[0];
}

/** The variable that held array `id` first. */
function holderOf({ analysis }: DetectContext, id: ObjId): VarInfo | undefined {
  return [...(analysis.objects.get(id)?.varKeys ?? [])]
    .map((k) => analysis.vars.get(k))
    .filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'))
    .sort(byFirstStep)[0];
}

export function detectTrees(ctx: DetectContext): Detection<TreeBindings>[] {
  const { tl, analysis } = ctx;
  const { objects, elems } = scanHeap(ctx);
  const out: Detection<TreeBindings>[] = [];
  for (const g of groupByShape(objects)) {
    const keys = new Set(g.members.flatMap((f) => f.props));
    const binary = BINARY_KEYS.some((k) => keys.has(k));
    if (!binary && !keys.has(CHILDREN_KEY)) continue;
    const nodes = treeNodes(g, binary, elems);
    if (!nodes) continue;
    const allocStep = (id: ObjId) => analysis.objects.get(id)?.allocStep ?? 0;
    const nodeIds = [...nodes].sort((x, y) => allocStep(x) - allocStep(y) || x - y);
    const members = g.members.filter((f) => nodes.has(f.id));
    // a property linking to objects (`parent`, `next`, a list of things) is not the node's value
    const plain = (k: string) => !LINK_KEYS.has(k) && members.every((f) => !f.refs.get(k)?.size);
    const valueKey = VALUE_KEYS.find((k) => keys.has(k)) ?? [...keys].find(plain);
    const pointers = pointerVars(ctx, nodes, g.cls);
    const root = rootVarOf(pointers, holderVars(ctx, objects, nodes));
    const pos = nodeArgPositions(tl, nodes);
    const traversalFns = [...analysis.recursiveFns].filter((f) => pos.has(f) && !isNodeCtor(tl, f, g.cls)).sort((x, y) => x - y);
    const held = new Set(members.flatMap((f) => [...f.refs.values()].flatMap((t) => [...t])));
    const childArrays = binary ? [] : members.flatMap((f) => [...(f.refs.get(CHILDREN_KEY) ?? [])]);
    const outputs = findOutputs(tl, nodes, new Set(traversalFns), valueKey, held).flatMap((o) => {
      const v = holderOf(ctx, o.id);
      return v ? [{ objId: o.id, ref: v.ref }] : [];
    });
    const claims = new Set([
      ...nodeIds.map((id) => `obj:${id}`),
      ...pointers.map((p) => varKey(p.ref)),
      ...traversalFns.map((f) => `fn:${f}`),
      ...childArrays.map((id) => `obj:${id}`),
      // the visit-order strip draws the output arrays
      ...outputs.flatMap((o) => [`obj:${o.objId}`, varKey(o.ref), ...(analysis.objects.get(o.objId)?.varKeys ?? [])]),
    ]);
    out.push({
      vizId: 'tree',
      key: `tree:${g.shape}`,
      title: root?.ref.name ?? g.cls ?? 'tree',
      score: 0.9,
      role: 'primary',
      claims: [...claims],
      bindings: {
        nodeShape: g.shape,
        valueKey,
        childKeys: binary ? [...BINARY_KEYS] : [CHILDREN_KEY],
        nodeIds,
        rootVar: root?.ref,
        pointers: pointers.map((p) => p.ref),
        traversalFns,
        output: outputs[0]?.ref,
        outputs,
      },
    });
  }
  return out;
}
