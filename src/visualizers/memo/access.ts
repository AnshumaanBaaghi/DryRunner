/**
 * Reads and writes of a cache's entries, each credited to the call of the recursion whose code made it
 * (its own frame or a helper it called), and what they say about each call: a cache hit (it returned an
 * entry without recursing) or a store (it wrote its result once its recursive calls returned). Entries
 * are keyed by Map key, property, array index or `row,col` of a 2D table (an array of row arrays).
 * Shared by detection and the per-step model. Pure.
 */
import { keyRepr } from '../../engine/timeline/heap';
import type { HeapChange, Snapshot, Timeline } from '../../engine/timeline/types';
import { isObj, previewValue, primitive, refId } from '../../engine/timeline/values';
import type { ReadEvent } from '../../engine/types/trace';
import { isUndef, sameV, type ObjId, type V } from '../../engine/types/values';
import type { CallTree, TreeNode } from '../shared/callTree';

export type CacheKind = 'map' | 'object' | 'array' | 'table';

export interface CacheSet {
  kind: CacheKind;
  /** the cache objects (a table: its outer arrays) */
  ids: ReadonlySet<ObjId>;
}

export interface Access {
  step: number;
  /** tree call credited with it; null for code outside the recursion (e.g. seeding the cache) */
  call: number | null;
  /** cache object (a table: its outer array) */
  cache: ObjId;
  /** entry identity within the cache (Map entries: `keyRepr` of the key) */
  key: string;
  /** the key as shown: `5`, `ab`, `2,3` */
  label: string;
  write: boolean;
  /** value written or read (absent for `has`) */
  value?: V;
  /** a read found the entry (`has` → true, a value that is not undefined) */
  found: boolean;
}

export const KEY_MAX = 8;

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A key as written in code: strings without quotes. */
export function keyText(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  const p = primitive(tl, v);
  return clip(p.ok && typeof p.value === 'string' ? p.value : previewValue(tl, snap, v, { depth: 0, maxString: KEY_MAX }), KEY_MAX);
}

/** A value read from the cache: neither undefined nor an array hole. */
export const present = (v: V | undefined): v is V => v !== undefined && !isUndef(v) && !(isObj(v) && 'hole' in v);

/** The frame whose code made a step's changes: a call step carries the caller's argument evaluation. */
function ownerFrame(tl: Timeline, s: number): number {
  const step = tl.steps[s];
  return step.kind === 'call' ? tl.calls.get(step.callId)?.parentId ?? 0 : step.callId;
}

/** Nearest tree call at or above a frame (a helper's work belongs to the tree call that invoked it). */
function creditor(tl: Timeline, tree: CallTree): (callId: number) => number | null {
  const known = new Map<number, number | null>();
  const find = (callId: number): number | null => {
    if (tree.nodes.has(callId)) return callId;
    const hit = known.get(callId);
    if (hit !== undefined) return hit;
    const call = tl.calls.get(callId);
    const out = call && call.parentId !== callId ? find(call.parentId) : null;
    known.set(callId, out);
    return out;
  };
  return find;
}

/** Objects whose entries the tree's calls write: Map sets, property and element sets. */
export function writtenByTree(tl: Timeline, tree: CallTree): Set<ObjId> {
  const credit = creditor(tl, tree);
  const out = new Set<ObjId>();
  for (let s = 0; s < tl.diffs.length; s++) {
    const heap = tl.diffs[s].heap;
    if (!heap.some((h) => h.op === 'mapSet' || (h.op === 'set' && h.path.length === 1))) continue;
    if (credit(ownerFrame(tl, s)) === null) continue;
    for (const h of heap) if (h.op === 'mapSet' || (h.op === 'set' && h.path.length === 1)) out.add(h.id);
  }
  return out;
}

/** Row array → its outer table array and row index (as the run left them). */
export function tableRows(tl: Timeline, outers: Iterable<ObjId>): Map<ObjId, { outer: ObjId; index: number }> {
  const heap = tl.snapshots[tl.snapshots.length - 1].heap;
  const out = new Map<ObjId, { outer: ObjId; index: number }>();
  for (const outer of outers) {
    heap.get(outer)?.elems?.forEach((e, index) => {
      const id = refId(e);
      if (id !== null && !out.has(id)) out.set(id, { outer, index });
    });
  }
  return out;
}

type Slot = Pick<Access, 'cache' | 'key' | 'label'>;

function slotOf(set: CacheSet, rows: ReturnType<typeof tableRows> | null, id: ObjId, path: (string | number)[]): Slot | null {
  if (path.length !== 1) return null;
  const k = path[0];
  if (set.kind === 'table') {
    const row = typeof k === 'number' ? rows?.get(id) : undefined;
    return row ? { cache: row.outer, key: `${row.index},${k}`, label: `${row.index},${k}` } : null;
  }
  if (!set.ids.has(id) || (set.kind === 'array' && typeof k !== 'number')) return null;
  return { cache: id, key: String(k), label: clip(String(k), KEY_MAX) };
}

function writeSlot(tl: Timeline, snap: Snapshot, set: CacheSet, rows: ReturnType<typeof tableRows> | null, h: HeapChange): Slot | null {
  if (set.kind === 'map') return h.op === 'mapSet' && set.ids.has(h.id) ? { cache: h.id, key: keyRepr(h.key), label: keyText(tl, snap, h.key) } : null;
  return h.op === 'set' ? slotOf(set, rows, h.id, h.path) : null;
}

function readSlot(tl: Timeline, snap: Snapshot, set: CacheSet, rows: ReturnType<typeof tableRows> | null, r: ReadEvent): Slot | null {
  if (set.kind === 'map') return r.op && set.ids.has(r.id) ? { cache: r.id, key: keyRepr(r.key), label: keyText(tl, snap, r.key) } : null;
  return r.op ? null : slotOf(set, rows, r.id, r.path);
}

const accessCache = new WeakMap<CallTree, Map<string, { steps: number; list: Access[] }>>();

/** Every read and write of the cache's entries in step order (writes from anywhere, reads by tree calls). */
export function cacheAccesses(tl: Timeline, tree: CallTree, set: CacheSet): Access[] {
  const ck = `${set.kind}:${[...set.ids].sort((a, b) => a - b).join(',')}`;
  let byKey = accessCache.get(tree);
  if (!byKey) accessCache.set(tree, (byKey = new Map()));
  const hit = byKey.get(ck);
  if (hit && hit.steps === tl.steps.length) return hit.list;
  const credit = creditor(tl, tree);
  const rows = set.kind === 'table' ? tableRows(tl, set.ids) : null;
  const list: Access[] = [];
  for (let s = 0; s < tl.diffs.length; s++) {
    const d = tl.diffs[s];
    if (!d.heap.length && !d.reads.length) continue;
    const snap = tl.snapshots[s];
    const call = credit(ownerFrame(tl, s));
    for (const h of d.heap) {
      const at = writeSlot(tl, snap, set, rows, h);
      if (at) list.push({ step: s, call, ...at, write: true, value: h.value, found: true });
    }
    if (call === null) continue;
    for (const r of d.reads) {
      const at = readSlot(tl, snap, set, rows, r);
      if (!at) continue;
      const found = r.op === 'has' ? r.value === true : present(r.value);
      list.push({ step: s, call, ...at, write: false, ...(r.op !== 'has' && { value: r.value }), found });
    }
  }
  byKey.set(ck, { steps: tl.steps.length, list });
  return list;
}

export interface Hit {
  /** the first lookup that found the entry */
  step: number;
  cache: ObjId;
  key: string;
  label: string;
  value: V;
  /** steps at which the call read the entry */
  reads: number[];
}

export interface Store {
  step: number;
  cache: ObjId;
  key: string;
  label: string;
  value: V;
}

export interface CallMemo {
  /** returned an entry without recursing */
  hit?: Hit;
  /** wrote its result into the cache */
  stored?: Store;
}

export interface MemoCalls {
  calls: Map<number, CallMemo>;
  /** hits on an entry an earlier call stored: the memoization at work */
  reuses: number;
  /** distinct entries the calls stored */
  storedKeys: number;
}

const slotKey = (a: { cache: ObjId; key: string }) => `${a.cache}|${a.key}`;

/** The read answering a call from the cache: an entry written before the call started, returned as is. */
function hitRead(n: TreeNode, end: number, own: readonly Access[], firstWrite: ReadonlyMap<string, number>): Access | undefined {
  return own.find((a) => !a.write && a.step <= end && present(a.value) && sameV(a.value, n.value)
    && (firstWrite.get(slotKey(a)) ?? Infinity) <= n.enterStep
    // not an entry the call wrote itself and read back
    && !own.some((w) => w.write && w.step < a.step && slotKey(w) === slotKey(a)));
}

/**
 * Hit: a call without recursive calls that read an entry written before it started and returned its
 * value. Store: a call writing its own result (the value it returns) after its last recursive call returned.
 */
export function memoCalls(tree: CallTree, accesses: readonly Access[]): MemoCalls {
  const byCall = new Map<number, Access[]>();
  const firstWrite = new Map<string, number>();
  for (const a of accesses) {
    if (a.write && !firstWrite.has(slotKey(a))) firstWrite.set(slotKey(a), a.step);
    if (a.call === null) continue;
    let list = byCall.get(a.call);
    if (!list) byCall.set(a.call, (list = []));
    list.push(a);
  }
  const calls = new Map<number, CallMemo>();
  for (const n of tree.nodes.values()) {
    const own = byCall.get(n.callId);
    const end = n.returnStep;
    if (!own || end === undefined || n.threw || !present(n.value)) continue;
    const memo: CallMemo = {};
    const last = n.children.length ? tree.nodes.get(n.children[n.children.length - 1])!.exitStep : n.enterStep;
    const w = last === undefined ? undefined : own.findLast((a) => a.write && a.step >= last && a.step <= end && sameV(a.value, n.value));
    if (w) memo.stored = { step: w.step, cache: w.cache, key: w.key, label: w.label, value: n.value };
    if (!n.children.length) {
      const r = hitRead(n, end, own, firstWrite);
      if (r) {
        const reads = own.filter((a) => !a.write && a.found && a.step <= end && slotKey(a) === slotKey(r)).map((a) => a.step);
        memo.hit = { step: reads[0], cache: r.cache, key: r.key, label: r.label, value: n.value, reads };
      }
    }
    if (memo.hit || memo.stored) calls.set(n.callId, memo);
  }
  const storedAt = new Map<string, number>();
  for (const m of calls.values()) {
    if (m.stored) storedAt.set(slotKey(m.stored), Math.min(storedAt.get(slotKey(m.stored)) ?? Infinity, m.stored.step));
  }
  let reuses = 0;
  for (const m of calls.values()) if (m.hit && (storedAt.get(slotKey(m.hit)) ?? Infinity) < m.hit.step) reuses += 1;
  return { calls, reuses, storedKeys: storedAt.size };
}
