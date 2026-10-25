/**
 * Linked lists: plain objects or class instances whose `next` (optionally also `prev`) refers to another
 * object of the same shape — the same class, or the same property names — with at least one link between
 * two of them at some step. Objects with left / right / children links are tree nodes and left alone.
 * Pointers are the variables holding a node at some step (the node class's own constructor only wires a
 * new node up, so its parameters are left out).
 */
import type { VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import { orderedProps } from '../../engine/timeline/heap';
import { refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { DetectContext, Detection } from '../types';

export interface LinkedListBindings {
  /** class name, or the property names of plain-object nodes (`{val}`) */
  nodeShape: string;
  /** every node, in allocation order */
  nodeIds: ObjId[];
  /** property shown in the node (absent when nodes carry nothing else) */
  valueKey?: string;
  nextKey: string;
  prevKey?: string;
  /** variables holding a node at some step, by first appearance */
  pointers: VarRef[];
  /** the variable the list is named after (head, list, …) */
  titleVar?: VarRef;
}

const NEXT_KEY = 'next';
const PREV_KEYS = ['prev', 'previous'];
const TREE_KEYS = ['left', 'right', 'children'];
const VALUE_KEYS = ['val', 'value', 'data', 'key'];
const LINK_KEYS = new Set([NEXT_KEY, ...PREV_KEYS]);
/** title variables, best first */
const TITLE_HINTS = [/^head$/i, /head/i, /^(list|l\d|first|start)$/i, /^(dummy|sentinel)/i];

interface ObjFacts {
  id: ObjId;
  cls?: string;
  /** own property names, first seen first */
  props: string[];
  /** property → objects it referred to at some step */
  refs: Map<string, Set<ObjId>>;
}

/** Property names and referenced objects of every plain object / class instance over the run. */
function scanObjects({ tl, analysis }: DetectContext): Map<ObjId, ObjFacts> {
  const facts = new Map<ObjId, ObjFacts>();
  const note = (f: ObjFacts, key: string, v: V | undefined) => {
    if (!f.props.includes(key)) f.props.push(key);
    const target = refId(v);
    if (target !== null) f.refs.set(key, (f.refs.get(key) ?? new Set<ObjId>()).add(target));
  };
  tl.diffs.forEach((d, i) => {
    for (const h of d.heap) {
      const info = analysis.objects.get(h.id);
      if (info?.kind !== 'object') continue;
      let f = facts.get(h.id);
      if (!f) {
        f = { id: h.id, cls: info.cls, props: [], refs: new Map() };
        facts.set(h.id, f);
      }
      if (h.op === 'alloc') {
        const obj = tl.snapshots[i].heap.get(h.id);
        if (obj) for (const [k, slot] of orderedProps(obj)) note(f, k, slot.v);
      } else if (h.op === 'set' && typeof h.path[0] === 'string') note(f, h.path[0], h.value);
    }
  });
  return facts;
}

/** Same class, or (plain objects) the same non-link property names. */
const shapeOf = (f: ObjFacts) => f.cls ?? `{${f.props.filter((k) => !LINK_KEYS.has(k)).sort().join(',')}}`;

interface NodeGroup {
  shape: string;
  cls?: string;
  members: ObjFacts[];
}

function groupByShape(facts: Map<ObjId, ObjFacts>): NodeGroup[] {
  const groups = new Map<string, NodeGroup>();
  for (const f of facts.values()) {
    const shape = shapeOf(f);
    const g = groups.get(shape) ?? { shape, cls: f.cls, members: [] };
    g.members.push(f);
    groups.set(shape, g);
  }
  return [...groups.values()];
}

/** Members with a `next` property or referred to by one; null unless two different members get linked. */
function linkedNodes(g: NodeGroup): Set<ObjId> | null {
  const ids = new Set(g.members.map((f) => f.id));
  const nodes = new Set<ObjId>();
  let linked = false;
  for (const f of g.members) {
    if (f.props.includes(NEXT_KEY)) nodes.add(f.id);
    for (const t of f.refs.get(NEXT_KEY) ?? []) {
      if (!ids.has(t)) continue;
      nodes.add(t);
      if (t !== f.id) linked = true;
    }
  }
  return linked ? nodes : null;
}

const byFirstStep = (x: VarInfo, y: VarInfo) => x.firstStep - y.firstStep;

function pointerVars({ tl, analysis }: DetectContext, nodes: Set<ObjId>, cls: string | undefined): VarInfo[] {
  return [...analysis.vars.values()]
    .filter((v) => {
      if (v.kinds.has('fn') || ![...v.heapIds].some((id) => nodes.has(id))) return false;
      const fn = tl.meta.fns[v.ref.fnId];
      return cls === undefined || !fn || (fn.kind === 'ctor' ? fn.className : fn.name) !== cls;
    })
    .sort(byFirstStep);
}

/** Variables holding an object that refers to a node (a list wrapper with `head` / `tail`). */
function holderVars({ analysis }: DetectContext, facts: Map<ObjId, ObjFacts>, nodes: Set<ObjId>): VarInfo[] {
  const holders = new Set<ObjId>();
  for (const f of facts.values()) {
    if (nodes.has(f.id)) continue;
    for (const targets of f.refs.values()) if ([...targets].some((t) => nodes.has(t))) holders.add(f.id);
  }
  return [...analysis.vars.values()].filter((v) => [...v.heapIds].some((id) => holders.has(id))).sort(byFirstStep);
}

function titleVar(pointers: VarInfo[], holders: VarInfo[]): VarInfo | undefined {
  for (const hint of TITLE_HINTS) {
    const hit = pointers.find((p) => hint.test(p.ref.name));
    if (hit) return hit;
  }
  return holders[0] ?? pointers[0];
}

export function detectLinkedLists(ctx: DetectContext): Detection<LinkedListBindings>[] {
  const facts = scanObjects(ctx);
  const out: Detection<LinkedListBindings>[] = [];
  for (const g of groupByShape(facts)) {
    const keys = new Set(g.members.flatMap((f) => f.props));
    if (!keys.has(NEXT_KEY) || TREE_KEYS.some((k) => keys.has(k))) continue;
    const nodes = linkedNodes(g);
    if (!nodes) continue;
    const allocStep = (id: ObjId) => ctx.analysis.objects.get(id)?.allocStep ?? 0;
    const nodeIds = [...nodes].sort((x, y) => allocStep(x) - allocStep(y) || x - y);
    // a property linking nodes (e.g. `random`) is not the node's value
    const linksNodes = (k: string) => g.members.some((f) => [...(f.refs.get(k) ?? [])].some((t) => nodes.has(t)));
    const valueKey = VALUE_KEYS.find((k) => keys.has(k)) ?? [...keys].find((k) => !LINK_KEYS.has(k) && !linksNodes(k));
    const pointers = pointerVars(ctx, nodes, g.cls);
    const title = titleVar(pointers, holderVars(ctx, facts, nodes));
    out.push({
      vizId: 'linkedList',
      key: `linkedList:${g.shape}`,
      title: title?.ref.name ?? g.cls ?? 'list',
      score: 0.9,
      role: 'primary',
      claims: [...new Set([...nodeIds.map((id) => `obj:${id}`), ...pointers.map((p) => varKey(p.ref))])],
      bindings: {
        nodeShape: g.shape,
        nodeIds,
        valueKey,
        nextKey: NEXT_KEY,
        prevKey: PREV_KEYS.find((k) => keys.has(k)),
        pointers: pointers.map((p) => p.ref),
        titleVar: title?.ref,
      },
    });
  }
  return out;
}
