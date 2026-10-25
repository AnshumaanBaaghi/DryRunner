/**
 * Vue-style tracking membrane. Invariants:
 *  - raw containers never hold proxies (every write path unwraps; fresh containers are cleaned),
 *  - everything leaving raw code is wrapped (reads, iterators, callback args, return values),
 *  - Proxy invariants hold (frozen/non-writable props are returned raw).
 * Mutations become semantic `mutate` events; index reads and Map/Set lookups become `read` events.
 */
import type { MutOp, ReadEvent, TraceEvent } from '../types/trace';
import type { V } from '../types/values';
import { arrayMethods } from './arrayMethods';
import { collectionMethods } from './collectionMethods';
import {
  getOwnPropertyDescriptor, getPrototypeOf, hasOwn, isArray, isExtensible, isView, MapProto, objectKeys,
  ProxyCtor, SetProto, WeakMapCtor, WeakSetCtor,
} from './primordials';
import { heapKindOf, Registry } from './registry';

export interface MembraneHost {
  emit(ev: TraceEvent): void;
  /** Read events are rate-limited per step by the host. */
  read(ev: ReadEvent): void;
}

export type MutateExtra = Partial<Pick<Extract<TraceEvent, { t: 'mutate' }>, 'key' | 'old' | 'value' | 'args' | 'removed' | 'after' | 'perm' | 'length'>>;

const INDEX_RE = /^(?:0|[1-9]\d{0,9})$/;
export const isIndexKey = (key: PropertyKey): key is string => typeof key === 'string' && INDEX_RE.test(key);

export class Membrane {
  readonly registry: Registry;
  private readonly rawToProxy = new WeakMapCtor<object, object>();
  private readonly proxyToRaw = new WeakMapCtor<object, object>();
  private readonly noProxyProtos = new WeakSetCtor<object>();
  private readonly frozenCheck = new WeakSetCtor<object>();
  private readonly host: MembraneHost;
  private readonly objectHandler: ProxyHandler<object>;
  private readonly collectionHandler: ProxyHandler<object>;
  private readonly typedHandler: ProxyHandler<object>;
  readonly arrayImpl: Record<PropertyKey, (...args: unknown[]) => unknown>;
  readonly collectionImpl: ReturnType<typeof collectionMethods>;

  constructor(host: MembraneHost) {
    this.host = host;
    this.registry = new Registry(host, (v) => this.unwrap(v));
    this.arrayImpl = arrayMethods(this);
    this.collectionImpl = collectionMethods(this);
    this.objectHandler = this.makeObjectHandler();
    this.collectionHandler = this.makeCollectionHandler();
    this.typedHandler = this.makeTypedHandler();
  }

  // ── identity ──
  unwrap<T>(v: T): T {
    if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
      const raw = this.proxyToRaw.get(v as object);
      if (raw) return raw as T;
    }
    return v;
  }

  rawOf(proxy: unknown): object | undefined {
    return proxy !== null && typeof proxy === 'object' ? this.proxyToRaw.get(proxy) : undefined;
  }

  idOf(raw: object): number {
    return this.registry.idOf(raw) ?? this.registry.register(raw);
  }

  ser(v: unknown): V {
    return this.registry.ser(v);
  }

  markNoProxy(ctor: unknown): void {
    const proto = (ctor as { prototype?: unknown })?.prototype;
    if (proto && typeof proto === 'object') this.noProxyProtos.add(proto);
  }

  private proxyable(raw: object, kind: string): boolean {
    if (!isExtensible(raw)) return false;
    if (kind === 'map') return getPrototypeOf(raw) === MapProto;
    if (kind === 'set') return getPrototypeOf(raw) === SetProto;
    if (kind === 'typed') return true;
    if (kind === 'array') return true;
    if (kind !== 'object') return false;
    for (let p = getPrototypeOf(raw) as object | null; p && p !== Object.prototype; p = getPrototypeOf(p) as object | null) {
      if (this.noProxyProtos.has(p)) return false;
    }
    return true;
  }

  /** Unwrap proxies stored inside a raw container (shallow). */
  private clean(raw: object, kind: string): void {
    if (kind === 'array') {
      const arr = raw as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const d = getOwnPropertyDescriptor(arr, i);
        if (d && 'value' in d && d.writable && this.proxyToRaw.has(d.value as object)) arr[i] = this.proxyToRaw.get(d.value as object);
      }
    } else if (kind === 'object') {
      for (const k of objectKeys(raw)) {
        const d = getOwnPropertyDescriptor(raw, k);
        if (d && 'value' in d && d.writable && d.value && this.proxyToRaw.has(d.value as object)) {
          (raw as Record<string, unknown>)[k] = this.proxyToRaw.get(d.value as object);
        }
      }
    } else if (kind === 'map' || kind === 'set') {
      this.collectionImpl.clean(raw, kind);
    }
  }

  /** Tracked view of a value: objects get a stable id (+ alloc) and, when safe, a tracking proxy. */
  track(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (this.proxyToRaw.has(v)) return v;
    const existing = this.rawToProxy.get(v);
    if (existing) return existing;
    const kind = heapKindOf(v);
    const canProxy = this.proxyable(v, kind);
    if (canProxy) this.clean(v, kind);
    this.registry.register(v);
    if (!canProxy) return v;
    const handler = kind === 'map' || kind === 'set' ? this.collectionHandler : kind === 'typed' ? this.typedHandler : this.objectHandler;
    const proxy = new ProxyCtor(v, handler);
    this.rawToProxy.set(v, proxy);
    this.proxyToRaw.set(proxy, v);
    return proxy;
  }

  /** Wrap a value leaving raw code (alias of track, kept separate for readability at call sites). */
  wrap(v: unknown): unknown {
    return this.track(v);
  }

  mutate(raw: object, op: MutOp, path: (string | number)[], extra: MutateExtra = {}): void {
    this.host.emit({ t: 'mutate', id: this.idOf(raw), op, path, ...extra });
  }

  read(raw: object, key: string | number, value: unknown): void {
    this.host.read({ t: 'read', id: this.idOf(raw), path: [key], value: this.ser(value) });
  }

  readKey(raw: object, op: 'get' | 'has', key: unknown, value: unknown): void {
    this.host.read({ t: 'read', id: this.idOf(raw), path: [], op, key: this.ser(key), value: this.ser(value) });
  }

  // ── handlers ──
  private makeObjectHandler(): ProxyHandler<object> {
    const self = this;
    return {
      get(target, key, receiver) {
        if (isArray(target) && typeof key !== 'number') {
          const impl = self.arrayImpl[key as string];
          if (impl && Reflect.get(target, key) === Reflect.get(Array.prototype, key)) return impl;
        }
        const value = Reflect.get(target, key, receiver);
        if (typeof key === 'symbol') return value;
        if (self.frozenCheck.has(target)) {
          const d = getOwnPropertyDescriptor(target, key);
          if (d && !d.configurable && 'value' in d && !d.writable) return value;
        }
        if (typeof value === 'function') return value;
        if (isArray(target)) {
          if (isIndexKey(key)) self.read(target, Number(key), value);
        } else if (hasOwn(target, key)) {
          self.read(target, key, value);
        }
        return self.wrap(value);
      },
      set(target, key, value, receiver) {
        if (typeof key === 'symbol') return Reflect.set(target, key, value, receiver);
        const raw = self.unwrap(value);
        if (isArray(target) && key === 'length') {
          const arr = target as unknown[];
          const oldLen = arr.length;
          const removed = typeof raw === 'number' && raw < oldLen ? arr.slice(raw) : [];
          const ok = Reflect.set(target, key, raw);
          if (ok && arr.length !== oldLen) {
            self.mutate(target, 'length', [], { length: arr.length, old: oldLen, removed: removed.map((r) => self.ser(r)) });
          }
          return ok;
        }
        // accessor anywhere on the chain: run the setter with the proxy as `this`, the setter traces itself
        for (let p: object | null = target; p; p = getPrototypeOf(p) as object | null) {
          const d = getOwnPropertyDescriptor(p, key);
          if (d) {
            if (!('value' in d)) return Reflect.set(target, key, raw, receiver);
            break;
          }
          if (isArray(target) && isIndexKey(key)) break;
        }
        const had = hasOwn(target, key);
        const oldDesc = had ? getOwnPropertyDescriptor(target, key) : undefined;
        const ok = Reflect.set(target, key, raw);
        if (ok) {
          const path = isArray(target) && isIndexKey(key) ? [Number(key)] : [key];
          const old = oldDesc && 'value' in oldDesc ? self.ser(oldDesc.value) : undefined;
          self.mutate(target, 'set', path, had ? { old, value: self.ser(raw) } : { value: self.ser(raw) });
        }
        return ok;
      },
      deleteProperty(target, key) {
        const d = typeof key === 'string' ? getOwnPropertyDescriptor(target, key) : undefined;
        const ok = Reflect.deleteProperty(target, key);
        if (ok && d && typeof key === 'string') {
          const path = isArray(target) && isIndexKey(key) ? [Number(key)] : [key];
          self.mutate(target, 'delete', path, { old: 'value' in d ? self.ser(d.value) : undefined });
        }
        return ok;
      },
      defineProperty(target, key, desc) {
        const next = 'value' in desc ? { ...desc, value: self.unwrap(desc.value) } : desc;
        const had = typeof key === 'string' && hasOwn(target, key);
        const oldDesc = had ? getOwnPropertyDescriptor(target, key) : undefined;
        const ok = Reflect.defineProperty(target, key, next);
        if (ok && (desc.configurable === false || desc.writable === false)) self.frozenCheck.add(target);
        if (ok && typeof key === 'string' && 'value' in next && !(oldDesc && 'value' in oldDesc && Object.is(oldDesc.value, next.value))) {
          const path = isArray(target) && isIndexKey(key) ? [Number(key)] : [key];
          self.mutate(target, 'set', path, { value: self.ser(next.value) });
        }
        return ok;
      },
      preventExtensions(target) {
        self.frozenCheck.add(target);
        return Reflect.preventExtensions(target);
      },
    };
  }

  private makeCollectionHandler(): ProxyHandler<object> {
    const self = this;
    return {
      get(target, key) {
        const impls = target instanceof Map ? self.collectionImpl.map : self.collectionImpl.set;
        if (key === 'size') return Reflect.get(target, 'size', target);
        const impl = impls[key as string];
        const proto = target instanceof Map ? MapProto : SetProto;
        if (impl && Reflect.get(target, key, target) === Reflect.get(proto, key)) return impl;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value : self.wrap(value);
      },
      set(target, key, value) {
        return Reflect.set(target, key, self.unwrap(value));
      },
    };
  }

  private makeTypedHandler(): ProxyHandler<object> {
    const self = this;
    const MUTATORS = new Set(['fill', 'set', 'sort', 'reverse', 'copyWithin']);
    return {
      get(target, key) {
        if (isIndexKey(key)) {
          const value = Reflect.get(target, key, target);
          self.read(target, Number(key), value);
          return value;
        }
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (typeof key === 'string' && MUTATORS.has(key)) {
          return function (this: unknown, ...args: unknown[]) {
            const raw = self.rawOf(this) ?? target;
            const result = Reflect.apply(value, raw, args.map((a) => self.unwrap(a)));
            const after = Array.from(raw as ArrayLike<number | bigint>, (x) => self.ser(x));
            self.mutate(raw, key as MutOp, [], { after });
            return result === raw ? this : result;
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
      set(target, key, value) {
        const ok = Reflect.set(target, key, self.unwrap(value));
        if (ok && isIndexKey(key)) {
          self.mutate(target, 'set', [Number(key)], { value: self.ser(Reflect.get(target, key, target)) });
        }
        return ok;
      },
    };
  }

  /** Helper for wrapped iterators over raw collections. */
  isView(v: unknown): boolean {
    return isView(v);
  }
}
