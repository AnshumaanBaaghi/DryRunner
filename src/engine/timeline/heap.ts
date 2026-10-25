/** Persistent heap objects: built from `alloc` data, updated by `mutate` events (structural sharing). */
import { List, Map as IMap } from 'immutable';
import type { MutateEvent } from '../types/trace';
import { UNDEF, type ObjId, type SerializedObj, type V } from '../types/values';
import type { EntrySlot, HeapObj, PropSlot } from './types';

export const HOLE: V = { hole: 1 };

/** A value the event may omit: `null` is a real value, only a missing one falls back. */
export const orElse = (v: V | undefined, fallback: V): V => (v === undefined ? fallback : v);

/** Canonical key for Map/Set entries (encoded values compare structurally). */
export function keyRepr(v: V | undefined): string {
  if (v === undefined) return 'u';
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      return `n:${v}`;
    case 'string':
      return `s:${v}`;
    case 'boolean':
      return `b:${v}`;
    default: {
      const [k] = Object.keys(v);
      return `${k}:${String((v as Record<string, unknown>)[k])}`;
    }
  }
}

export function fromSerialized(id: ObjId, data: SerializedObj): HeapObj {
  const base: HeapObj = { id, kind: data.kind, nextOrd: 0 };
  if (data.cls) base.cls = data.cls;
  if (data.text !== undefined) base.text = data.text;
  if (data.elems) {
    base.elems = List(data.elems);
    if (data.length !== undefined && data.length !== data.elems.length) base.length = data.length;
  }
  if (data.props) {
    base.props = IMap<string, PropSlot>(data.props.map(([k, v], i) => [k, { v, ord: i }]));
    base.nextOrd = data.props.length;
  }
  if (data.entries) {
    base.entries = IMap<string, EntrySlot>(data.entries.map(([k, v], i) => [keyRepr(k), { k, v, ord: i }]));
    base.nextOrd = data.entries.length;
  }
  if (data.values) {
    base.entries = IMap<string, EntrySlot>(data.values.map((v, i) => [keyRepr(v), { k: v, v, ord: i }]));
    base.nextOrd = data.values.length;
  }
  if ((data.kind === 'array' || data.kind === 'typed') && !base.elems) base.elems = List();
  return base;
}

function setElem(elems: List<V>, index: number, value: V): List<V> {
  let list = elems;
  if (index > list.size) list = list.concat(List(new Array<V>(index - list.size).fill(HOLE)));
  return list.set(index, value);
}

function setProp(obj: HeapObj, key: string, value: V): HeapObj {
  const props = obj.props ?? IMap<string, PropSlot>();
  const existing = props.get(key);
  if (existing) return { ...obj, props: props.set(key, { v: value, ord: existing.ord }) };
  return { ...obj, props: props.set(key, { v: value, ord: obj.nextOrd }), nextOrd: obj.nextOrd + 1 };
}

function setEntry(obj: HeapObj, key: V, value: V): HeapObj {
  const entries = obj.entries ?? IMap<string, EntrySlot>();
  const repr = keyRepr(key);
  const existing = entries.get(repr);
  if (existing) return { ...obj, entries: entries.set(repr, { k: key, v: value, ord: existing.ord }) };
  return { ...obj, entries: entries.set(repr, { k: key, v: value, ord: obj.nextOrd }), nextOrd: obj.nextOrd + 1 };
}

export function applyMutation(obj: HeapObj, ev: MutateEvent): HeapObj {
  const elems = obj.elems;
  const p0 = ev.path[0];
  switch (ev.op) {
    case 'set':
      if (elems && typeof p0 === 'number') return { ...obj, elems: setElem(elems, p0, orElse(ev.value, HOLE)) };
      return setProp(obj, String(p0), orElse(ev.value, UNDEF));
    case 'delete':
      if (elems && typeof p0 === 'number') return p0 < elems.size ? { ...obj, elems: elems.set(p0, HOLE) } : obj;
      return obj.props ? { ...obj, props: obj.props.delete(String(p0)) } : obj;
    case 'length': {
      if (!elems || ev.length === undefined) return obj;
      if (ev.length <= elems.size) return { ...obj, elems: elems.setSize(ev.length) };
      return { ...obj, elems: elems.concat(List(new Array<V>(ev.length - elems.size).fill(HOLE))) };
    }
    case 'push':
      return elems ? { ...obj, elems: elems.push(...(ev.args ?? [])) } : obj;
    case 'pop':
      return elems ? { ...obj, elems: elems.pop() } : obj;
    case 'shift':
      return elems ? { ...obj, elems: elems.shift() } : obj;
    case 'unshift':
      return elems ? { ...obj, elems: elems.unshift(...(ev.args ?? [])) } : obj;
    case 'splice': {
      if (!elems || typeof p0 !== 'number') return obj;
      return { ...obj, elems: elems.splice(p0, ev.removed?.length ?? 0, ...(ev.args ?? [])) };
    }
    case 'sort':
    case 'reverse':
    case 'fill':
    case 'copyWithin':
      return ev.after ? { ...obj, elems: List(ev.after) } : obj;
    case 'mapSet':
      return setEntry(obj, orElse(ev.key, UNDEF), orElse(ev.value, UNDEF));
    case 'setAdd':
      return setEntry(obj, orElse(ev.key, UNDEF), orElse(ev.key, UNDEF));
    case 'mapDelete':
    case 'setDelete':
      return obj.entries ? { ...obj, entries: obj.entries.delete(keyRepr(ev.key)) } : obj;
    case 'mapClear':
    case 'setClear':
      return obj.entries ? { ...obj, entries: obj.entries.clear() } : obj;
    default:
      return obj;
  }
}

const INDEX_KEY = /^(?:0|[1-9]\d*)$/;

/** Own keys in JavaScript order: integer-like keys ascending, then insertion order. */
export function orderedProps(obj: HeapObj): [string, PropSlot][] {
  if (!obj.props) return [];
  const all = [...obj.props.entries()];
  const ints = all.filter(([k]) => INDEX_KEY.test(k)).sort((a, b) => Number(a[0]) - Number(b[0]));
  const rest = all.filter(([k]) => !INDEX_KEY.test(k)).sort((a, b) => a[1].ord - b[1].ord);
  return [...ints, ...rest];
}

export function orderedEntries(obj: HeapObj): EntrySlot[] {
  if (!obj.entries) return [];
  return [...obj.entries.values()].sort((a, b) => a.ord - b.ord);
}
