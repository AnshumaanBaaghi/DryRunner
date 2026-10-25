/**
 * Node links over the whole run, replayed from the heap diffs: the stable slot order (the longest chain
 * observed at any step fills the first slots, the longest chain of the remaining nodes the next ones, and
 * so on, so nodes never move while links change) and every node → node link ever made (arc sizing).
 */
import type { Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { LinkedListBindings } from './detect';

type NextMap = Map<ObjId, ObjId | null>;

/** extra passes for chains of nodes left out by the longer ones (input lists beside a result list) */
const MAX_PASSES = 8;

interface ReplayHooks {
  /** after every step that allocated a node or rewrote a `next` */
  visit?(alive: ObjId[], next: NextMap): void;
  /** every node → node link (next and prev) when it is made */
  onLink?(from: ObjId, to: ObjId): void;
}

function replay(tl: Timeline, b: LinkedListBindings, { visit, onLink }: ReplayHooks): void {
  const nodes = new Set(b.nodeIds);
  const keys = b.prevKey ? [b.nextKey, b.prevKey] : [b.nextKey];
  const alive: ObjId[] = [];
  const next: NextMap = new Map();
  const link = (from: ObjId, key: string, v: V | undefined) => {
    const t = refId(v);
    const to = t !== null && nodes.has(t) ? t : null;
    if (key === b.nextKey) next.set(from, to);
    if (to !== null) onLink?.(from, to);
  };
  tl.diffs.forEach((d, i) => {
    let changed = false;
    for (const h of d.heap) {
      if (!nodes.has(h.id)) continue;
      if (h.op === 'alloc') {
        alive.push(h.id);
        const props = tl.snapshots[i].heap.get(h.id)?.props;
        for (const key of keys) link(h.id, key, props?.get(key)?.v);
        changed = true;
      } else if (h.op === 'set' && keys.includes(String(h.path[0]))) {
        link(h.id, String(h.path[0]), h.value);
        if (String(h.path[0]) === b.nextKey) changed = true;
      }
    }
    if (changed) visit?.(alive, next);
  });
}

/**
 * The chains of one step: walks along `next` from every node nothing links to, then from the nodes left
 * over (a cycle nothing outside links into). Nodes in `skip` are left out and end the walks.
 */
export function chainsOf(alive: readonly ObjId[], next: ReadonlyMap<ObjId, ObjId | null>, skip: ReadonlySet<ObjId> = new Set()): ObjId[][] {
  const live = alive.filter((id) => !skip.has(id));
  const target = (id: ObjId) => {
    const t = next.get(id);
    return t === undefined || t === null || skip.has(t) ? null : t;
  };
  const linkedTo = new Set<ObjId>();
  for (const id of live) {
    const t = target(id);
    if (t !== null && t !== id) linkedTo.add(t);
  }
  const seen = new Set<ObjId>();
  const out: ObjId[][] = [];
  const walk = (start: ObjId) => {
    const chain: ObjId[] = [];
    const inChain = new Set<ObjId>();
    for (let id: ObjId | null = start; id !== null && !inChain.has(id); id = target(id)) {
      chain.push(id);
      inChain.add(id);
      seen.add(id);
    }
    out.push(chain);
  };
  for (const id of live) if (!linkedTo.has(id)) walk(id);
  for (const id of live) if (!seen.has(id)) walk(id);
  return out;
}

/** Node ids by slot: the longest chain of any step first (ties: the earliest), then the longest of the rest, … */
export function stableOrder(tl: Timeline, b: LinkedListBindings): ObjId[] {
  const placed = new Set<ObjId>();
  const order: ObjId[] = [];
  for (let pass = 0; pass < MAX_PASSES && placed.size < b.nodeIds.length; pass++) {
    let best: ObjId[] = [];
    replay(tl, b, {
      visit(alive, next) {
        for (const chain of chainsOf(alive, next, placed)) if (chain.length > best.length) best = chain;
      },
    });
    if (best.length < 2) break;
    for (const id of best) {
      placed.add(id);
      order.push(id);
    }
  }
  // nodes never linked into a chain keep their allocation order
  for (const id of b.nodeIds) if (!placed.has(id)) order.push(id);
  return order;
}

/** Every distinct node → node link (next or prev) made during the run. */
export function linkPairs(tl: Timeline, b: LinkedListBindings): [ObjId, ObjId][] {
  const seen = new Map<string, [ObjId, ObjId]>();
  replay(tl, b, {
    onLink(from, to) {
      const key = `${from}>${to}`;
      if (!seen.has(key)) seen.set(key, [from, to]);
    },
  });
  return [...seen.values()];
}
