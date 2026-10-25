/**
 * Array.prototype interceptors installed by the membrane. Mutators run natively on the raw target and
 * emit ONE semantic event; readers run on the raw target with unwrapped search args and wrapped outputs,
 * so callbacks see tracked elements and no per-element read flood happens.
 */
import type { V } from '../types/values';
import type { Membrane } from './membrane';
import { ArrayProto as P } from './primordials';

type Fn = (this: unknown, ...args: unknown[]) => unknown;

const toInt = (x: unknown): number => {
  const n = Number(x);
  if (Number.isNaN(n)) return 0;
  return Math.trunc(n);
};

export function arrayMethods(m: Membrane): Record<PropertyKey, Fn> {
  const rawOf = (self: unknown) => m.rawOf(self) as unknown[] | undefined;
  const serAll = (arr: ArrayLike<unknown>): V[] => {
    const out: V[] = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = m.ser(arr[i]);
    return out;
  };
  const unwrapAll = (arr: unknown[]): unknown[] => {
    const out: unknown[] = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = m.unwrap(arr[i]);
    return out;
  };
  const native = (name: string) => (Reflect.get(P, name) as (...a: unknown[]) => unknown);

  /** Stable index sort with spec SortCompare semantics (undefined last, holes removed to the end). */
  const sortedOrder = (raw: unknown[], cmp: unknown): { order: number[]; values: unknown[] } => {
    if (cmp !== undefined && typeof cmp !== 'function') {
      throw new TypeError('The comparison function must be either a function or undefined');
    }
    const n = raw.length;
    const values: unknown[] = new Array(n);
    const present: number[] = [];
    const undef: number[] = [];
    const holes: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!(i in raw)) {
        holes[holes.length] = i;
        continue;
      }
      values[i] = raw[i];
      if (raw[i] === undefined) undef[undef.length] = i;
      else present[present.length] = i;
    }
    const compare = typeof cmp === 'function'
      ? (a: number, b: number) => {
        const r = Number(Reflect.apply(cmp, undefined, [m.wrap(values[a]), m.wrap(values[b])]));
        return Number.isNaN(r) ? 0 : r;
      }
      : (a: number, b: number) => {
        const x = String(values[a]);
        const y = String(values[b]);
        return x < y ? -1 : x > y ? 1 : 0;
      };
    Reflect.apply(P.sort, present, [compare]);
    return { order: [...present, ...undef, ...holes], values };
  };

  const impl: Record<PropertyKey, Fn> = {
    push(...items) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.push, this, items);
      const start = raw.length;
      const rawItems = unwrapAll(items);
      const r = Reflect.apply(P.push, raw, rawItems);
      m.mutate(raw, 'push', [start], { args: serAll(rawItems) });
      return r;
    },
    pop() {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.pop, this, []);
      if (raw.length === 0) return undefined;
      const idx = raw.length - 1;
      const removed = Reflect.apply(P.pop, raw, []);
      m.mutate(raw, 'pop', [idx], { old: m.ser(removed) });
      return m.wrap(removed);
    },
    shift() {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.shift, this, []);
      if (raw.length === 0) return undefined;
      const removed = Reflect.apply(P.shift, raw, []);
      m.mutate(raw, 'shift', [0], { old: m.ser(removed) });
      return m.wrap(removed);
    },
    unshift(...items) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.unshift, this, items);
      const rawItems = unwrapAll(items);
      const r = Reflect.apply(P.unshift, raw, rawItems);
      if (rawItems.length) m.mutate(raw, 'unshift', [0], { args: serAll(rawItems) });
      return r;
    },
    splice(...args) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.splice, this, args);
      const len = raw.length;
      const rel = args.length ? toInt(args[0]) : 0;
      const start = rel < 0 ? Math.max(len + rel, 0) : Math.min(rel, len);
      const rawArgs = args.map((a, i) => (i >= 2 ? m.unwrap(a) : a));
      const removed = Reflect.apply(P.splice, raw, rawArgs) as unknown[];
      const inserted = rawArgs.slice(2);
      if (removed.length || inserted.length) {
        m.mutate(raw, 'splice', [start], { removed: serAll(removed), args: serAll(inserted) });
      }
      return m.track(removed);
    },
    sort(cmp) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.sort, this, [cmp]);
      const { order, values } = sortedOrder(raw, cmp);
      const n = raw.length;
      let k = 0;
      for (const idx of order) {
        if (!(idx in values)) break; // holes are ordered last
        raw[k++] = values[idx];
      }
      for (; k < n; k++) delete raw[k];
      m.mutate(raw, 'sort', [], { perm: order, after: serAll(raw) });
      return this;
    },
    reverse() {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.reverse, this, []);
      Reflect.apply(P.reverse, raw, []);
      const n = raw.length;
      const perm: number[] = new Array(n);
      for (let i = 0; i < n; i++) perm[i] = n - 1 - i;
      m.mutate(raw, 'reverse', [], { perm, after: serAll(raw) });
      return this;
    },
    fill(...args) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.fill, this, args);
      const rawArgs = args.length ? [m.unwrap(args[0]), ...args.slice(1)] : args;
      Reflect.apply(P.fill, raw, rawArgs);
      m.mutate(raw, 'fill', [], { after: serAll(raw) });
      return this;
    },
    copyWithin(...args) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.copyWithin, this, args);
      Reflect.apply(P.copyWithin, raw, args);
      m.mutate(raw, 'copyWithin', [], { after: serAll(raw) });
      return this;
    },
    at(i) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(P.at, this, [i]);
      const v = Reflect.apply(P.at, raw, [i]);
      const rel = toInt(i);
      const idx = rel < 0 ? raw.length + rel : rel;
      if (idx >= 0 && idx < raw.length) m.read(raw, idx, v);
      return m.wrap(v);
    },
    toSorted(cmp) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(native('toSorted'), this, [cmp]);
      const { order, values } = sortedOrder(raw, cmp);
      return m.track(order.map((idx) => values[idx]));
    },
  };

  // search methods: compare against raw elements
  for (const name of ['indexOf', 'lastIndexOf', 'includes']) {
    const fn = native(name);
    impl[name] = function (this: unknown, ...args: unknown[]) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(fn, this, args);
      return Reflect.apply(fn, raw, args.length ? [m.unwrap(args[0]), ...args.slice(1)] : args);
    };
  }
  // pure readers returning primitives
  for (const name of ['join', 'toString', 'toLocaleString', 'keys']) {
    const fn = native(name);
    impl[name] = function (this: unknown, ...args: unknown[]) {
      const raw = rawOf(this);
      return Reflect.apply(fn, raw ?? this, args);
    };
  }
  // readers returning fresh arrays
  for (const name of ['slice', 'concat', 'flat', 'toReversed', 'toSpliced', 'with']) {
    const fn = native(name);
    if (typeof fn !== 'function') continue;
    impl[name] = function (this: unknown, ...args: unknown[]) {
      const raw = rawOf(this);
      if (!raw) return Reflect.apply(fn, this, args);
      return m.track(Reflect.apply(fn, raw, unwrapAll(args)));
    };
  }
  // callback iteration: callbacks receive wrapped elements and the proxy as the array argument
  const RESULT_ARRAY = new Set(['map', 'filter', 'flatMap']);
  const RESULT_ELEMENT = new Set(['find', 'findLast']);
  for (const name of ['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap']) {
    const fn = native(name);
    if (typeof fn !== 'function') continue;
    impl[name] = function (this: unknown, cb: unknown, thisArg?: unknown) {
      const raw = rawOf(this);
      if (!raw || typeof cb !== 'function') return Reflect.apply(fn, raw ?? this, [cb, thisArg]);
      const proxy = this;
      const wrapped = function (v: unknown, i: number) {
        return Reflect.apply(cb, thisArg, [m.wrap(v), i, proxy]);
      };
      const result = Reflect.apply(fn, raw, [wrapped]);
      if (RESULT_ARRAY.has(name)) return m.track(result);
      if (RESULT_ELEMENT.has(name)) return m.wrap(result);
      return result;
    };
  }
  for (const name of ['reduce', 'reduceRight']) {
    const fn = native(name);
    impl[name] = function (this: unknown, cb: unknown, ...init: unknown[]) {
      const raw = rawOf(this);
      if (!raw || typeof cb !== 'function') return Reflect.apply(fn, raw ?? this, [cb, ...init]);
      const proxy = this;
      const wrapped = (acc: unknown, v: unknown, i: number) => Reflect.apply(cb, undefined, [m.wrap(acc), m.wrap(v), i, proxy]);
      return m.wrap(Reflect.apply(fn, raw, init.length ? [wrapped, m.unwrap(init[0])] : [wrapped]));
    };
  }
  // iterators yield tracked elements (live: re-read length each step, like ArrayIterator)
  const values = function (this: unknown) {
    const raw = rawOf(this);
    if (!raw) return Reflect.apply(P.values, this, []);
    return (function* () {
      for (let i = 0; i < raw.length; i++) yield m.wrap(raw[i]);
    })();
  };
  impl.values = values;
  impl[Symbol.iterator] = values;
  impl.entries = function (this: unknown) {
    const raw = rawOf(this);
    if (!raw) return Reflect.apply(P.entries, this, []);
    return (function* () {
      for (let i = 0; i < raw.length; i++) yield [i, m.wrap(raw[i])];
    })();
  };
  return impl;
}
