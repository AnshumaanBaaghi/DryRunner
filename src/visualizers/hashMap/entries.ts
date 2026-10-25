/**
 * The hash map shown at each step and what a step did to it: its entries (Map / Set insertion order,
 * own properties in JavaScript order), the entries the step added, updated or removed (comparing the
 * snapshots around it) and the keys it looked up, found or not. Plus compact card texts. Shared by the
 * view model and the HUD lines. Pure.
 */
import { trackVar, valueAt } from '../../engine/detect/track';
import { keyRepr, orderedEntries, orderedProps } from '../../engine/timeline/heap';
import type { HeapChange, HeapObj, Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, primitive, refId } from '../../engine/timeline/values';
import type { ReadEvent } from '../../engine/types/trace';
import { isUndef, type ObjId, type V } from '../../engine/types/values';
import { LABEL_GLYPHS } from '../../scene/glyphs';
import { hashKindOf, type HashKind, type HashMapBindings } from './detect';

export interface Entry {
  /** identity: `keyRepr` of a Map key or Set value, a property name */
  id: string;
  key: V;
  value: V;
}

export function entriesOf(obj: HeapObj | undefined, kind: HashKind): Entry[] {
  if (!obj) return [];
  if (kind === 'object') return orderedProps(obj).map(([k, slot]) => ({ id: k, key: k, value: slot.v }));
  return orderedEntries(obj).map((e) => ({ id: keyRepr(e.k), key: e.k, value: e.v }));
}

function entryOf(obj: HeapObj | undefined, kind: HashKind, id: string): Entry | undefined {
  if (kind === 'object') {
    const slot = obj?.props?.get(id);
    return slot && { id, key: id, value: slot.v };
  }
  const e = obj?.entries?.get(id);
  return e && { id, key: e.k, value: e.v };
}

export const sizeOf = (obj: HeapObj | undefined, kind: HashKind) => (kind === 'object' ? obj?.props?.size : obj?.entries?.size) ?? 0;

// ── the object shown ──

/** Cache key of a detection's bindings. */
export const bindingKey = (b: HashMapBindings) => `${b.kind}:${b.objId}|${b.target.fnId}:${b.target.name}:${b.target.bids.join(',')}`;

const followCache = new WeakMap<Timeline, Map<string, { steps: number; ids: ReadonlySet<ObjId> }>>();

/** The bound object and every other object of its kind the variable names (e.g. a Set made per loop iteration). */
export function followedIds(tl: Timeline, b: HashMapBindings): ReadonlySet<ObjId> {
  const key = bindingKey(b);
  let byKey = followCache.get(tl);
  if (!byKey) followCache.set(tl, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.steps === tl.steps.length) return hit.ids;
  const heap = tl.snapshots[tl.snapshots.length - 1].heap;
  const ids = new Set<ObjId>([b.objId]);
  for (const v of trackVar(tl, b.target)) {
    const id = refId(v);
    const obj = id === null ? undefined : heap.get(id);
    if (obj && hashKindOf(obj.kind, obj.cls) === b.kind) ids.add(obj.id);
  }
  byKey.set(key, { steps: tl.steps.length, ids });
  return ids;
}

/** The object shown at step i: the one the variable names then, else the bound one. */
export function shownId(tl: Timeline, b: HashMapBindings, i: number): ObjId {
  const id = refId(valueAt(tl, b.target, i));
  return id !== null && followedIds(tl, b).has(id) ? id : b.objId;
}

// ── what a step did ──

/** An entry a step touched: `before` / `after` as the snapshots around it hold it. */
export type Change =
  | { kind: 'added'; id: string; after: Entry }
  | { kind: 'updated'; id: string; before: Entry; after: Entry }
  | { kind: 'removed'; id: string; before: Entry };

export interface Lookup {
  id: string;
  key: V;
  found: boolean;
  /** what a `get` or a property read returned */
  value?: V;
}

export interface StepEvents {
  /** the step allocated the object (its first entries count as added) */
  created: boolean;
  /** a clear() emptied it */
  cleared: boolean;
  /** in the order the step first touched the entries */
  changes: Change[];
  /** one per key in lookup order, found when any of the step's reads of it found it */
  lookups: Lookup[];
}

const present = (v: V | undefined): v is V => v !== undefined && !isUndef(v);

function touchedKey(h: HeapChange, kind: HashKind): string | null {
  if (kind === 'object') return (h.op === 'set' || h.op === 'delete') && h.path.length === 1 ? String(h.path[0]) : null;
  const keyed = kind === 'map' ? h.op === 'mapSet' || h.op === 'mapDelete' : h.op === 'setAdd' || h.op === 'setDelete';
  return keyed ? keyRepr(h.key) : null;
}

/** Map get / has, Set has, an own property read (the runtime records no misses for objects, nor `in`). */
function lookupOf(r: ReadEvent, kind: HashKind): Lookup | null {
  if (kind === 'object') return !r.op && r.path.length === 1 ? { id: String(r.path[0]), key: String(r.path[0]), found: true, value: r.value } : null;
  const keyed = r.op === 'has' || (r.op === 'get' && kind === 'map');
  if (!keyed || r.key === undefined) return null;
  const found = r.op === 'has' ? r.value === true : present(r.value);
  return { id: keyRepr(r.key), key: r.key, found, ...(r.op === 'get' && found && { value: r.value }) };
}

/** What step s did to object `id`: entry changes from snapshot s - 1 to s, and the lookups it made. */
export function eventsAt(tl: Timeline, s: number, id: ObjId, kind: HashKind): StepEvents {
  const out: StepEvents = { created: false, cleared: false, changes: [], lookups: [] };
  const diff = tl.diffs[s];
  if (!diff) return out;
  const before = s > 0 ? tl.snapshots[s - 1].heap.get(id) : undefined;
  const after = tl.snapshots[s].heap.get(id);
  const touched = new Set<string>();
  for (const h of diff.heap) {
    if (h.id !== id) continue;
    const clear = h.op === 'mapClear' || h.op === 'setClear';
    if (h.op === 'alloc') out.created = true;
    if (clear) out.cleared = true;
    if (h.op === 'alloc' || clear) for (const e of entriesOf(clear ? before : after, kind)) touched.add(e.id);
    const k = touchedKey(h, kind);
    if (k !== null) touched.add(k);
  }
  for (const k of touched) {
    const was = entryOf(before, kind, k);
    const now = entryOf(after, kind, k);
    if (now) out.changes.push(was ? { kind: 'updated', id: k, before: was, after: now } : { kind: 'added', id: k, after: now });
    else if (was) out.changes.push({ kind: 'removed', id: k, before: was });
  }
  const lookups = new Map<string, Lookup>();
  for (const r of diff.reads) {
    const l = r.id === id ? lookupOf(r, kind) : null;
    if (!l) continue;
    const prev = lookups.get(l.id);
    const value = l.value ?? prev?.value;
    lookups.set(l.id, { id: l.id, key: l.key, found: l.found || Boolean(prev?.found), ...(value !== undefined && { value }) });
  }
  out.lookups = [...lookups.values()];
  return out;
}

// ── texts ──

export const KEY_MAX = 10;
export const VALUE_MAX = 10;

const GLYPHS = new Set(LABEL_GLYPHS);
/** Characters the label font lacks become '?'. */
export const glyphSafe = (s: string) => [...s].map((ch) => (GLYPHS.has(ch) ? ch : '?')).join('');

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A key as written in code: strings without quotes. */
export function keyText(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  const p = primitive(tl, v);
  const text = p.ok && typeof p.value === 'string' ? p.value : previewValue(tl, snap, v, { depth: 0, maxString: KEY_MAX });
  return glyphSafe(clip(text, KEY_MAX));
}

export const valueText = (tl: Timeline, snap: Snapshot, v: V | undefined) =>
  glyphSafe(clip(previewValue(tl, snap, v, { depth: 0, maxString: VALUE_MAX }), VALUE_MAX));

/** `key → value` (Map), `key` (Set), `key: value` (object). */
export function cardText(tl: Timeline, snap: Snapshot, kind: HashKind, e: Entry): string {
  const key = keyText(tl, snap, e.key);
  if (kind === 'set') return key;
  return `${key}${kind === 'map' ? ' →' : ':'} ${valueText(tl, snap, e.value)}`;
}

/** Chip text for the keys a lookup missed. */
export const missText = (keys: string[]) => `miss ${clip(keys.join(', '), KEY_MAX)}`;

/** HUD text of a key or value: quoted strings, short collections. */
export const hudText = (tl: Timeline, snap: Snapshot, v: V | undefined) => previewValue(tl, snap, v, { depth: 1, maxItems: 4, maxString: 12 });
