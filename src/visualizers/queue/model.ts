/**
 * Pure per-step model of the queue visualizer (testable without WebGL): the items front → rear with
 * stable identities, the ones arriving or leaving at this step (and through which end), and for
 * priority queues each item's priority and the item extracted next.
 */
import { valueAt } from '../../engine/detect/track';
import { orderedProps } from '../../engine/timeline/heap';
import type { HeapObj, Snapshot, Timeline } from '../../engine/timeline/types';
import { deref, previewValue, primitive } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { idsAt } from '../array/identity';
import { clip } from '../callStack/model';
import type { QueueBindings, QueueMode } from './detect';

export const SPACING = 1.12;
/** characters an item label keeps (the view shrinks the font to fit) */
export const MAX_LABEL = 10;

export type Side = 'front' | 'rear';

export interface ItemModel {
  /** identity: pushed items keep theirs, sorts permute them */
  key: string;
  /** position from the front */
  slot: number;
  x: number;
  label: string;
  /** priority queues: the number itself, the first element of `[priority, value]`, or a `dist` / `priority` field */
  priority: number | null;
  /** arriving at this step through this end (stepping back: returning through the end the undone step took it from) */
  enter: Side | null;
  /** priority queues: the item extracted next */
  next: boolean;
}

export interface LeavingModel extends ItemModel {
  exit: Side;
}

export interface QueueModel {
  exists: boolean;
  /** front → rear */
  items: ItemModel[];
  /** items leaving at this step, as they were one step away */
  leaving: LeavingModel[];
  /** the longest queue of the run: the conveyor's fixed length */
  maxLen: number;
  /** re-sorted at this step: the items glide to their new places */
  resorted: boolean;
  /** head-index queues: the front's index in the underlying array */
  headIndex: number | null;
  /** where the item that moved this step is */
  focusX: number | null;
}

export interface QueueOp {
  kind: 'add' | 'remove' | 'sort';
  side: Side;
  values: V[];
}

export const xOf = (slot: number, maxLen: number) => (slot - (maxLen - 1) / 2) * SPACING;

const flip = (s: Side): Side => (s === 'front' ? 'rear' : 'front');

/** The items array at step i: the holder's array, or (class / object queues) the array in its property. */
export function arrayAt(tl: Timeline, b: QueueBindings, i: number): HeapObj | null {
  const snap = tl.snapshots[i];
  let obj = deref(snap, valueAt(tl, b.target, i));
  if (obj && b.prop) obj = deref(snap, obj.props?.get(b.prop)?.v);
  return obj?.kind === 'array' ? obj : null;
}

function headAt(tl: Timeline, b: QueueBindings, i: number): number {
  if (!b.head || i < 0) return 0;
  const v = valueAt(tl, b.head, i);
  return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

interface Entry {
  key: string;
  v: V;
}

/** The queue at step i, front → rear (a queue filled with unshift is drained from the array's end). */
function logicalAt(tl: Timeline, b: QueueBindings, i: number): { id: ObjId; entries: Entry[]; head: number } | null {
  const arr = arrayAt(tl, b, i);
  if (!arr) return null;
  const elems = arr.elems?.toArray() ?? [];
  const ids = idsAt(tl, arr.id, i);
  const head = Math.min(headAt(tl, b, i), elems.length);
  const entries = elems.map((v, k) => ({ key: ids?.[k] !== undefined ? `${arr.id}:${ids[k]}` : `${arr.id}@${k}`, v })).slice(head);
  if (b.frontAtEnd) entries.reverse();
  return { id: arr.id, entries, head };
}

/** What step s did to the queue, by logical end (the head-index form dequeues by advancing `head`). */
export function stepOps(tl: Timeline, s: number, b: QueueBindings): QueueOp[] {
  if (s <= 0 || s >= tl.steps.length) return [];
  const arr = arrayAt(tl, b, s);
  if (!arr) return [];
  const side = (end: Side) => (b.frontAtEnd ? flip(end) : end);
  const out: QueueOp[] = [];
  for (const h of tl.diffs[s].heap) {
    if (h.id !== arr.id) continue;
    if (h.op === 'push' || h.op === 'unshift') out.push({ kind: 'add', side: side(h.op === 'push' ? 'rear' : 'front'), values: h.args ?? [] });
    else if (h.op === 'shift' || h.op === 'pop') {
      out.push({ kind: 'remove', side: side(h.op === 'shift' ? 'front' : 'rear'), values: h.old === undefined ? [] : [h.old] });
    } else if (h.op === 'splice') {
      const end = side(h.path[0] === 0 ? 'front' : 'rear');
      if (h.removed?.length) out.push({ kind: 'remove', side: end, values: h.removed });
      if (h.args?.length) out.push({ kind: 'add', side: end, values: h.args });
    } else if (h.op === 'sort' || h.op === 'reverse') out.push({ kind: 'sort', side: 'front', values: [] });
  }
  const before = headAt(tl, b, s - 1);
  const after = headAt(tl, b, s);
  if (after > before) out.push({ kind: 'remove', side: 'front', values: (arr.elems?.toArray() ?? []).slice(before, after) });
  return out;
}

const PRIORITY_KEY = /^(priority|prio|pri|dist|distance|cost|weight|w|d|key|time|score|rank|f|g|p)$/i;
const VALUE_KEY = /^(val|value|node|vertex|v|u|id|name|label|item|data|key)$/i;

const short = (tl: Timeline, snap: Snapshot, v: V | undefined) => previewValue(tl, snap, v, { depth: 0, maxString: 5 });

function num(tl: Timeline, v: V | undefined): number | null {
  const p = primitive(tl, v);
  return typeof p.value === 'number' && !Number.isNaN(p.value) ? p.value : null;
}

/** The primitive field an object (tree node, record) is known by: its val / value / id / name. */
export function knownBy(snap: Snapshot, obj: HeapObj | undefined): V | undefined {
  if (!obj?.props) return undefined;
  return orderedProps(obj).find(([k, slot]) => VALUE_KEY.test(k) && deref(snap, slot.v) === undefined)?.[1].v;
}

/** What an item stands for: arrays as `[a, b]`, objects by the field they are known by. */
function brief(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  const obj = deref(snap, v);
  if (obj?.kind === 'array') return previewValue(tl, snap, v, { depth: 1, maxItems: 3, maxString: 4 });
  return short(tl, snap, knownBy(snap, obj) ?? v);
}

/** Priority and the rest of an item: `4`, `[4, node]`, `{ dist: 4, node }`. */
export function priorityOf(tl: Timeline, snap: Snapshot, v: V | undefined): { priority: number | null; label: string } {
  const own = num(tl, v);
  if (own !== null) return { priority: own, label: short(tl, snap, v) };
  const obj = deref(snap, v);
  let first: V | undefined;
  let rest: string | null = null;
  if (obj?.kind === 'array') {
    const elems = obj.elems?.toArray() ?? [];
    first = elems[0];
    if (elems.length === 2) rest = brief(tl, snap, elems[1]);
    else if (elems.length > 2) rest = elems.slice(1).map((e) => short(tl, snap, e)).join(',');
  } else if (obj?.props) {
    const props = orderedProps(obj);
    const key = props.find(([k, s]) => PRIORITY_KEY.test(k) && num(tl, s.v) !== null) ?? props.find(([, s]) => num(tl, s.v) !== null);
    const other = key && props.find(([k]) => k !== key[0] && VALUE_KEY.test(k));
    first = key?.[1].v;
    if (other) rest = brief(tl, snap, other[1].v);
  }
  const priority = num(tl, first);
  if (priority === null) return { priority: null, label: brief(tl, snap, v) };
  return { priority, label: rest === null ? short(tl, snap, first) : `${short(tl, snap, first)} · ${rest}` };
}

function texts(tl: Timeline, snap: Snapshot, v: V, mode: QueueMode): Pick<ItemModel, 'label' | 'priority'> {
  if (mode !== 'priority') return { label: clip(brief(tl, snap, v), MAX_LABEL), priority: null };
  const p = priorityOf(tl, snap, v);
  return { label: clip(p.label, MAX_LABEL), priority: p.priority };
}

interface Stats {
  maxLen: number;
  /** priority queues: the smallest priority comes out first (else the largest) */
  minFirst: boolean;
  /** priority queues: extractions followed an order of numeric priorities */
  ranked: boolean;
  n: number;
}

const statsCache = new WeakMap<Timeline, Map<string, Stats>>();

/** Run-wide facts: the longest queue (a stable conveyor) and which end of the priority order comes out first. */
export function queueStats(tl: Timeline, b: QueueBindings): Stats {
  let byKey = statsCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    statsCache.set(tl, byKey);
  }
  const key = `${b.target.fnId}:${b.target.name}:${b.prop ?? ''}:${b.head?.name ?? ''}:${b.mode}:${b.frontAtEnd ? 1 : 0}`;
  const hit = byKey.get(key);
  if (hit && hit.n === tl.steps.length) return hit;
  let maxLen = 0;
  let mins = 0;
  let maxes = 0;
  for (let i = 0; i < tl.steps.length; i++) {
    const arr = arrayAt(tl, b, i);
    if (!arr) continue;
    const size = arr.elems?.size ?? 0;
    maxLen = Math.max(maxLen, size - Math.min(headAt(tl, b, i), size));
    if (b.mode !== 'priority') continue;
    const snap = tl.snapshots[i];
    const removed = stepOps(tl, i, b).filter((op) => op.kind === 'remove').flatMap((op) => op.values);
    if (!removed.length) continue;
    // an extracted item ranks first among the ones left behind
    const left = (arr.elems?.toArray() ?? []).map((e) => priorityOf(tl, snap, e).priority).filter((p): p is number => p !== null);
    for (const v of removed) {
      const p = priorityOf(tl, snap, v).priority;
      if (p === null || !left.length) continue;
      if (p <= Math.min(...left)) mins += 1;
      if (p >= Math.max(...left)) maxes += 1;
    }
  }
  const stats = { maxLen, minFirst: mins >= maxes, ranked: mins + maxes > 0, n: tl.steps.length };
  byKey.set(key, stats);
  return stats;
}

/** The item a re-sort would bring to the front: the best priority, the earliest of ties (sorts are stable). */
function markNext(items: ItemModel[], minFirst: boolean): void {
  let best: ItemModel | undefined;
  let bestP = 0;
  for (const it of items) {
    if (it.priority === null || (best && (minFirst ? it.priority >= bestP : it.priority <= bestP))) continue;
    best = it;
    bestP = it.priority;
  }
  const next = best ?? items[0];
  if (next) next.next = true;
}

export function buildQueueModel(tl: Timeline, i: number, b: QueueBindings, hl: Highlight | null): QueueModel {
  const stats = queueStats(tl, b);
  const maxLen = Math.max(1, stats.maxLen);
  const cur = logicalAt(tl, b, i);
  if (!cur) return { exists: false, items: [], leaving: [], maxLen, resorted: false, headIndex: null, focusX: null };
  const toItems = (entries: Entry[], snap: Snapshot): ItemModel[] => {
    const items = entries.map((e, slot) => ({ key: e.key, slot, x: xOf(slot, maxLen), ...texts(tl, snap, e.v, b.mode), enter: null, next: false }));
    if (b.mode === 'priority') markNext(items, stats.minFirst);
    return items;
  };
  const items = toItems(cur.entries, tl.snapshots[i]);
  // forward: this step's changes; backward: the undone step's, played in reverse
  const ops = hl ? stepOps(tl, hl.reversed ? i + 1 : i, b) : [];
  const j = hl?.reversed ? i + 1 : i - 1;
  const other = hl && ops.length && j >= 0 && j < tl.steps.length ? logicalAt(tl, b, j) : null;
  let leaving: LeavingModel[] = [];
  if (hl && other && other.id === cur.id) {
    const here = new Set(cur.entries.map((e) => e.key));
    const there = new Set(other.entries.map((e) => e.key));
    const added = ops.find((op) => op.kind === 'add')?.side;
    const removed = ops.find((op) => op.kind === 'remove')?.side;
    // the end an item crossed: before the first item that stays (front) or after it (rear)
    const kept = (entries: Entry[], keep: Set<string>) => entries.findIndex((e) => keep.has(e.key));
    const keptHere = kept(cur.entries, there);
    for (const it of items) {
      if (there.has(it.key)) continue;
      const fallback = hl.reversed ? removed ?? 'front' : added ?? 'rear';
      it.enter = keptHere < 0 ? fallback : it.slot < keptHere ? 'front' : 'rear';
    }
    const keptThere = kept(other.entries, here);
    leaving = toItems(other.entries, tl.snapshots[j]).filter((it) => !here.has(it.key)).map((it) => {
      const fallback = hl.reversed ? added ?? 'rear' : removed ?? 'front';
      return { ...it, exit: keptThere < 0 ? fallback : it.slot < keptThere ? 'front' : 'rear' };
    });
  }
  const resorted = ops.some((op) => op.kind === 'sort');
  const moved = items.find((it) => it.enter) ?? leaving[0] ?? (resorted ? items.find((it) => it.next) ?? items[0] : undefined);
  return { exists: true, items, leaving, maxLen, resorted, headIndex: b.head ? cur.head : null, focusX: moved ? moved.x : null };
}
