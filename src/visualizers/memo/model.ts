/**
 * Pure per-step model of the memo view (testable without WebGL): what each call did with the cache
 * (a hit, a stored result, or neither), node labels and looks, and the cache panel — its entries in
 * insertion order, the entry stored or read this step and the hits so far.
 */
import { trackVar, valueAt } from '../../engine/detect/track';
import { keyRepr, orderedEntries } from '../../engine/timeline/heap';
import type { HeapObj, Snapshot, Timeline } from '../../engine/timeline/types';
import { deref, previewValue, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import { callText, constantArgs, hasReturned, type CallTree, type NodePhase, type TreeNode } from '../shared/callTree';
import { defaultLook, LABEL_SIZE, type NodeLook } from '../shared/treeState';
import { cacheAccesses, clip, KEY_MAX, keyText, memoCalls, present, type Access, type CallMemo } from './access';
import type { MemoBindings } from './detect';

/** resting cache entry: a muted green, like the finished calls whose results they hold */
export const ENTRY_COLOR = '#1f6b4a';
/** most cards the panel shows (the newest entries) */
export const CARD_CAP = 16;
/** badge font size used by CallTreeView */
const BADGE_SIZE = 0.26;
const VALUE_MAX = 8;

export const textWidth = (s: string, size: number) => [...s].length * size * 0.6;

export const valueText = (tl: Timeline, snap: Snapshot, v: V | undefined, max = VALUE_MAX) =>
  clip(previewValue(tl, snap, v, { depth: 0, maxString: max }), max);

// ── per-call facts ──

export interface MemoInfo {
  /** the objects the cache variable names during the run (a table: its outer arrays) */
  cacheIds: Set<ObjId>;
  /** call → its cache hit and / or stored result */
  calls: Map<number, CallMemo>;
  /** step → the call whose lookup found its cached value there */
  hitAt: Map<number, number>;
  /** step → the call that stored its result there */
  storeAt: Map<number, number>;
  /** step → the entry a cache hit read there */
  readAt: Map<number, { cache: ObjId; key: string }>;
  /** lookup steps of the hits, in order */
  hitSteps: number[];
  /** entry writes by step */
  writesAt: Map<number, Access[]>;
  /** array and table caches: each entry's first write, in write order (the order entries are listed in) */
  firstWrite: Map<ObjId, Map<string, { label: string; step: number }>>;
}

const KIND_OBJ = { map: 'map', object: 'object', array: 'array', table: 'array' } as const;

function cacheIdsOf(tl: Timeline, b: MemoBindings): Set<ObjId> {
  const heap = tl.snapshots[tl.snapshots.length - 1].heap;
  const out = new Set<ObjId>();
  for (const v of trackVar(tl, b.cache)) {
    const id = refId(v);
    if (id !== null && heap.get(id)?.kind === KIND_OBJ[b.kind]) out.add(id);
  }
  return out;
}

const infoCache = new WeakMap<CallTree, Map<string, { steps: number; info: MemoInfo }>>();

export function memoInfo(tl: Timeline, tree: CallTree, b: MemoBindings): MemoInfo {
  const key = `${b.kind}|${b.cache.fnId}:${b.cache.name}`;
  let byKey = infoCache.get(tree);
  if (!byKey) infoCache.set(tree, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.steps === tl.steps.length) return hit.info;
  const cacheIds = cacheIdsOf(tl, b);
  const accesses = cacheAccesses(tl, tree, { kind: b.kind, ids: cacheIds });
  const { calls } = memoCalls(tree, accesses);
  const info: MemoInfo = {
    cacheIds, calls, hitAt: new Map(), storeAt: new Map(), readAt: new Map(), hitSteps: [], writesAt: new Map(), firstWrite: new Map(),
  };
  for (const [callId, m] of calls) {
    if (m.hit) {
      info.hitAt.set(m.hit.step, callId);
      info.hitSteps.push(m.hit.step);
      for (const s of m.hit.reads) info.readAt.set(s, { cache: m.hit.cache, key: m.hit.key });
    }
    if (m.stored) info.storeAt.set(m.stored.step, callId);
  }
  info.hitSteps.sort((x, y) => x - y);
  for (const a of accesses) {
    if (!a.write) continue;
    info.writesAt.set(a.step, [...(info.writesAt.get(a.step) ?? []), a]);
    let order = info.firstWrite.get(a.cache);
    if (!order) info.firstWrite.set(a.cache, (order = new Map()));
    if (!order.has(a.key)) order.set(a.key, { label: a.label, step: a.step });
  }
  byKey.set(key, { steps: tl.steps.length, info });
  return info;
}

// ── tree ──

export interface NodeTexts {
  /** `fib(5)`, `go(1, 2, memo)` */
  labels: Map<number, string>;
  /** returned value */
  values: Map<number, string>;
}

const textCache = new WeakMap<MemoInfo, NodeTexts>();

/** Call labels — arguments that are the same object in every call, or the cache itself, go by parameter name — and returned values. */
export function nodeTexts(tl: Timeline, tree: CallTree, info: MemoInfo): NodeTexts {
  const hit = textCache.get(info);
  if (hit) return hit;
  const constant = constantArgs(tree);
  const out: NodeTexts = { labels: new Map(), values: new Map() };
  for (const n of tree.nodes.values()) {
    const named = new Set(constant.get(n.fnId));
    n.args.forEach((v, k) => {
      const id = refId(v);
      if (id !== null && info.cacheIds.has(id)) named.add(k);
    });
    out.labels.set(n.callId, callText(tl, tl.snapshots[n.enterStep], n, named));
    if (n.returnStep !== undefined) out.values.set(n.callId, valueText(tl, tl.snapshots[n.returnStep], n.value));
  }
  textCache.set(info, out);
  return out;
}

/** The badge a call ends up with (sizes the layout once for the whole run). */
export function finalBadge(n: TreeNode, memo: CallMemo | undefined, value: string): string {
  if (n.threw) return 'threw';
  if (memo?.hit) return `cached = ${value}`;
  return n.returnStep !== undefined ? `= ${value}` : '';
}

/** Layout width of a call: room for its label and its widest badge. */
export const nodeWidth = (label: string, badge: string) =>
  Math.max(1, textWidth(label, LABEL_SIZE) + 0.3, textWidth(badge, BADGE_SIZE) + 0.2);

/**
 * Default phase colors; a cache hit turns violet with "cached = v" from its lookup on; a result shows
 * "= v" once returned, or already once stored (in orange while the call finishes).
 */
export function nodeLook(phase: NodePhase, n: TreeNode, i: number, memo: CallMemo | undefined, label: string, value: string): NodeLook {
  const look: NodeLook = { ...defaultLook(phase), label };
  if (phase === 'future') return look;
  if (phase === 'threw') return { ...look, badge: 'threw' };
  if (memo?.hit && memo.hit.step <= i) {
    return { ...look, color: COLORS.frontier, glow: phase === 'active' ? 1.5 : 0.5, badge: `cached = ${value}`, badgeColor: COLORS.frontier };
  }
  if (hasReturned(n, i)) return { ...look, badge: `= ${value}` };
  if (memo?.stored && memo.stored.step <= i) return { ...look, badge: `= ${value}`, badgeColor: COLORS.changed };
  return look;
}

// ── cache panel ──

export interface EntryModel {
  /** entry identity (as in `Access.key`) */
  id: string;
  key: string;
  value: string;
}

/** The cache object the variable names at step i. */
export function cacheAt(tl: Timeline, b: MemoBindings, info: MemoInfo, i: number): HeapObj | undefined {
  const id = refId(valueAt(tl, b.cache, i));
  return id !== null && info.cacheIds.has(id) ? tl.snapshots[i]?.heap.get(id) : undefined;
}

function cellOf(snap: Snapshot, obj: HeapObj, key: string, table: boolean): V | undefined {
  if (!table) return obj.elems?.get(Number(key));
  const [r, c] = key.split(',').map(Number);
  return deref(snap, obj.elems?.get(r))?.elems?.get(c);
}

/** Entries at step i in insertion order: Map entries, own properties, or the slots written so far (arrays, tables). */
export function entriesAt(tl: Timeline, i: number, b: MemoBindings, info: MemoInfo, obj: HeapObj): EntryModel[] {
  const snap = tl.snapshots[i];
  if (b.kind === 'map') return orderedEntries(obj).map((e) => ({ id: keyRepr(e.k), key: keyText(tl, snap, e.k), value: valueText(tl, snap, e.v) }));
  if (b.kind === 'object') {
    return [...(obj.props?.entries() ?? [])].sort((x, y) => x[1].ord - y[1].ord)
      .map(([k, slot]) => ({ id: k, key: clip(k, KEY_MAX), value: valueText(tl, snap, slot.v) }));
  }
  const out: EntryModel[] = [];
  for (const [key, w] of info.firstWrite.get(obj.id) ?? []) {
    if (w.step > i) break;
    const v = cellOf(snap, obj, key, b.kind === 'table');
    if (present(v)) out.push({ id: key, key: w.label, value: valueText(tl, snap, v) });
  }
  return out;
}

/** The entry existed at `step` (before a write at the next step). */
function hadEntry(tl: Timeline, step: number, b: MemoBindings, info: MemoInfo, cache: ObjId, key: string): boolean {
  if (step < 0) return false;
  const obj = tl.snapshots[step].heap.get(cache);
  if (b.kind === 'map') return Boolean(obj?.entries?.has(key));
  if (b.kind === 'object') return Boolean(obj?.props?.has(key));
  return (info.firstWrite.get(cache)?.get(key)?.step ?? Infinity) <= step;
}

export interface CardModel {
  id: string;
  /** `key → value` */
  text: string;
  color: string;
  /** stored, updated or read by a hit at this step */
  pulse: boolean;
  /** just stored: drops into place */
  entered: boolean;
}

export interface CacheModel {
  name: string;
  /** the cache object exists at this step */
  exists: boolean;
  /** shown entries in insertion order (the newest CARD_CAP) */
  cards: CardModel[];
  /** older entries left out */
  hidden: number;
  entries: number;
  /** cache hits so far */
  hits: number;
  /** entry written at this step */
  written: { id: string; isNew: boolean } | null;
  /** entry a cache hit read at this step */
  read: string | null;
  /** stepping back over a store: the entry it added, lifting out of the slot after the last card */
  leaving: { slot: number; text: string } | null;
}

/** The newest CARD_CAP entries; an older entry read this step takes the first slot. */
function windowOf(entries: EntryModel[], keep: string | null): EntryModel[] {
  if (entries.length <= CARD_CAP) return entries;
  const start = entries.length - CARD_CAP;
  const k = keep === null ? -1 : entries.findIndex((e) => e.id === keep);
  return k >= 0 && k < start ? [entries[k], ...entries.slice(start + 1)] : entries.slice(start);
}

/** How many of the sorted steps are ≤ i. */
function countUpTo(sorted: number[], i: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function buildCache(tl: Timeline, i: number, b: MemoBindings, info: MemoInfo, hl: Highlight | null): CacheModel {
  const obj = cacheAt(tl, b, info, i);
  const entries = obj ? entriesAt(tl, i, b, info, obj) : [];
  const writesAt = (s: number) => (obj ? (info.writesAt.get(s) ?? []).filter((w) => w.cache === obj.id) : []);
  const last = writesAt(i).at(-1);
  const written = obj && last ? { id: last.key, isNew: !hadEntry(tl, i - 1, b, info, obj.id, last.key) } : null;
  const r = info.readAt.get(i);
  const read = obj && r?.cache === obj.id ? r.key : null;
  // emphasis follows playback: forward — this step's store or hit; backward — the store being undone
  const reversed = hl?.reversed ?? false;
  const changed = new Set<string>();
  const entered = new Set<string>();
  let gone: Access | undefined;
  for (const w of hl && obj ? writesAt(reversed ? i + 1 : i) : []) {
    if (!reversed) {
      changed.add(w.key);
      if (!hadEntry(tl, i - 1, b, info, w.cache, w.key)) entered.add(w.key);
    } else if (entries.some((e) => e.id === w.key)) changed.add(w.key);
    else gone = w;
  }
  const flash = hl && !reversed ? read : null;
  const shown = windowOf(entries, read);
  const cards = shown.map((e): CardModel => {
    const hot = e.id === flash;
    const color = hot ? COLORS.frontier : changed.has(e.id) ? COLORS.changed : ENTRY_COLOR;
    return { id: e.id, text: `${e.key} → ${e.value}`, color, pulse: hot || changed.has(e.id), entered: entered.has(e.id) };
  });
  const leaving = gone && shown.length < CARD_CAP
    ? { slot: shown.length, text: `${gone.label} → ${valueText(tl, tl.snapshots[i + 1], gone.value)}` }
    : null;
  return {
    name: b.cache.name, exists: Boolean(obj), cards, hidden: entries.length - shown.length, entries: entries.length,
    hits: countUpTo(info.hitSteps, i), written, read, leaving,
  };
}

export interface CacheExtent {
  /** most entries the cache holds at once */
  maxEntries: number;
  /** longest card text (characters) */
  widest: number;
  /** hits over the whole run */
  hits: number;
}

const extentCache = new WeakMap<MemoInfo, CacheExtent>();

const sizeOf = (b: MemoBindings, obj: HeapObj | undefined) => (b.kind === 'map' ? obj?.entries?.size : obj?.props?.size) ?? 0;

/** Trace-wide sizes of the panel, so it never jumps: entries only appear where they are written (or seeded). */
export function cacheExtent(tl: Timeline, b: MemoBindings, info: MemoInfo): CacheExtent {
  const hit = extentCache.get(info);
  if (hit) return hit;
  const extent: CacheExtent = { maxEntries: 0, widest: 0, hits: info.hitSteps.length };
  const note = (text: string, size: number) => {
    extent.widest = Math.max(extent.widest, [...text].length);
    extent.maxEntries = Math.max(extent.maxEntries, size);
  };
  // entries a cache holds where the variable first names it (a Map or object literal seeds some)
  trackVar(tl, b.cache).forEach((v, s, all) => {
    const obj = refId(v) === null || (s > 0 && refId(all[s - 1]) === refId(v)) ? undefined : cacheAt(tl, b, info, s);
    const seeded = obj ? entriesAt(tl, s, b, info, obj) : [];
    for (const e of seeded) note(`${e.key} → ${e.value}`, seeded.length);
  });
  const keyed = b.kind === 'map' || b.kind === 'object';
  for (const [s, writes] of info.writesAt) {
    for (const w of writes) note(`${w.label} → ${valueText(tl, tl.snapshots[s], w.value)}`, keyed ? sizeOf(b, tl.snapshots[s].heap.get(w.cache)) : 0);
  }
  // arrays and tables list every slot ever written
  if (!keyed) for (const order of info.firstWrite.values()) extent.maxEntries = Math.max(extent.maxEntries, order.size);
  extentCache.set(info, extent);
  return extent;
}
