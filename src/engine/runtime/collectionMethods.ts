/** Map/Set interceptors: run on the raw collection (internal slots), unwrap keys/values in, wrap out. */
import type { Membrane } from './membrane';
import {
  mapClear, mapDelete, mapEntries, mapForEach, mapGet, mapHas, MapProto, mapSet, mapSize, setAdd, setClear,
  setDelete, setForEach, setHas, SetProto, setSize, setValues,
} from './primordials';

type Fn = (this: unknown, ...args: unknown[]) => unknown;

export function collectionMethods(m: Membrane) {
  const rawMap = (self: unknown) => {
    const raw = m.rawOf(self);
    return raw instanceof Map ? (raw as Map<unknown, unknown>) : undefined;
  };
  const rawSet = (self: unknown) => {
    const raw = m.rawOf(self);
    return raw instanceof Set ? (raw as Set<unknown>) : undefined;
  };
  const iterate = <T>(it: IterableIterator<T>, map: (v: T) => unknown) => (function* () {
    for (let r = it.next(); !r.done; r = it.next()) yield map(r.value);
  })();

  const map: Record<PropertyKey, Fn> = {
    get(k) {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.get, this, [k]);
      const rk = m.unwrap(k);
      const v = mapGet(raw, rk);
      m.readKey(raw, 'get', rk, v);
      return m.wrap(v);
    },
    has(k) {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.has, this, [k]);
      const rk = m.unwrap(k);
      const found = mapHas(raw, rk);
      m.readKey(raw, 'has', rk, found);
      return found;
    },
    set(k, v) {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.set, this, [k, v]);
      const rk = m.unwrap(k);
      const rv = m.unwrap(v);
      const had = mapHas(raw, rk);
      const old = had ? mapGet(raw, rk) : undefined;
      mapSet(raw, rk, rv);
      m.mutate(raw, 'mapSet', [], had ? { key: m.ser(rk), old: m.ser(old), value: m.ser(rv) } : { key: m.ser(rk), value: m.ser(rv) });
      return this;
    },
    delete(k) {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.delete, this, [k]);
      const rk = m.unwrap(k);
      const had = mapHas(raw, rk);
      const old = had ? mapGet(raw, rk) : undefined;
      const ok = mapDelete(raw, rk);
      if (ok) m.mutate(raw, 'mapDelete', [], { key: m.ser(rk), old: m.ser(old) });
      return ok;
    },
    clear() {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.clear, this, []);
      if (mapSize(raw)) m.mutate(raw, 'mapClear', []);
      mapClear(raw);
      return undefined;
    },
    forEach(cb, thisArg) {
      const raw = rawMap(this);
      if (!raw || typeof cb !== 'function') return Reflect.apply(MapProto.forEach, raw ?? this, [cb, thisArg]);
      const proxy = this;
      mapForEach(raw, (v, k) => Reflect.apply(cb, thisArg, [m.wrap(v), m.wrap(k), proxy]));
      return undefined;
    },
    keys() {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.keys, this, []);
      return iterate(mapEntries(raw), ([k]) => m.wrap(k));
    },
    values() {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.values, this, []);
      return iterate(mapEntries(raw), ([, v]) => m.wrap(v));
    },
    entries() {
      const raw = rawMap(this);
      if (!raw) return Reflect.apply(MapProto.entries, this, []);
      return iterate(mapEntries(raw), ([k, v]) => [m.wrap(k), m.wrap(v)]);
    },
  };
  map[Symbol.iterator] = map.entries;

  const set: Record<PropertyKey, Fn> = {
    add(v) {
      const raw = rawSet(this);
      if (!raw) return Reflect.apply(SetProto.add, this, [v]);
      const rv = m.unwrap(v);
      if (!setHas(raw, rv)) {
        setAdd(raw, rv);
        m.mutate(raw, 'setAdd', [], { key: m.ser(rv) });
      }
      return this;
    },
    has(v) {
      const raw = rawSet(this);
      if (!raw) return Reflect.apply(SetProto.has, this, [v]);
      const rv = m.unwrap(v);
      const found = setHas(raw, rv);
      m.readKey(raw, 'has', rv, found);
      return found;
    },
    delete(v) {
      const raw = rawSet(this);
      if (!raw) return Reflect.apply(SetProto.delete, this, [v]);
      const rv = m.unwrap(v);
      const ok = setDelete(raw, rv);
      if (ok) m.mutate(raw, 'setDelete', [], { key: m.ser(rv) });
      return ok;
    },
    clear() {
      const raw = rawSet(this);
      if (!raw) return Reflect.apply(SetProto.clear, this, []);
      if (setSize(raw)) m.mutate(raw, 'setClear', []);
      setClear(raw);
      return undefined;
    },
    forEach(cb, thisArg) {
      const raw = rawSet(this);
      if (!raw || typeof cb !== 'function') return Reflect.apply(SetProto.forEach, raw ?? this, [cb, thisArg]);
      const proxy = this;
      setForEach(raw, (v) => Reflect.apply(cb, thisArg, [m.wrap(v), m.wrap(v), proxy]));
      return undefined;
    },
    values() {
      const raw = rawSet(this);
      if (!raw) return Reflect.apply(SetProto.values, this, []);
      return iterate(setValues(raw), (v) => m.wrap(v));
    },
    entries() {
      const raw = rawSet(this);
      if (!raw) return Reflect.apply(SetProto.entries, this, []);
      return iterate(setValues(raw), (v) => [m.wrap(v), m.wrap(v)]);
    },
  };
  set.keys = set.values;
  set[Symbol.iterator] = set.values;

  /** Unwrap proxies used as keys/values (rebuilds in insertion order when needed). */
  const clean = (raw: object, kind: string): void => {
    if (kind === 'map') {
      const mp = raw as Map<unknown, unknown>;
      const entries = [...iterate(mapEntries(mp), (e) => e)] as [unknown, unknown][];
      if (!entries.some(([k, v]) => m.unwrap(k) !== k || m.unwrap(v) !== v)) return;
      mapClear(mp);
      for (const [k, v] of entries) mapSet(mp, m.unwrap(k), m.unwrap(v));
    } else {
      const st = raw as Set<unknown>;
      const values = [...iterate(setValues(st), (v) => v)];
      if (!values.some((v) => m.unwrap(v) !== v)) return;
      setClear(st);
      for (const v of values) setAdd(st, m.unwrap(v));
    }
  };

  return { map, set, clean };
}
