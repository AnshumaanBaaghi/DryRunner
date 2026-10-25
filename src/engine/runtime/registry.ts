/**
 * Object identity + value encoding. Every object that reaches the trace gets a stable id and one `alloc`
 * event (shallow: nested objects become refs). Registration is iterative so long linked lists cannot
 * overflow the stack; getters are never invoked.
 */
import type { TraceEvent } from '../types/trace';
import type { HeapKind, SerializedObj, V } from '../types/values';
import { UNDEF } from '../types/values';
import {
  DateCtor, ErrorCtor, getOwnPropertyDescriptor, getPrototypeOf, isArray, isView, mapEntries, MapCtor,
  numberIsNaN, objectIs, objectKeys, RegExpCtor, setValues, SetCtor, stringSlice, WeakMapCtor,
} from './primordials';

export const MAX_ELEMS = 10_000;
export const MAX_PROPS = 1_000;
export const MAX_OBJECTS = 50_000;
export const INTERN_MIN = 65;
export const MAX_STRING = 10_000;

export interface Emitter {
  emit(ev: TraceEvent): void;
}

export function heapKindOf(raw: object): HeapKind {
  if (isArray(raw)) return 'array';
  if (raw instanceof MapCtor) return 'map';
  if (raw instanceof SetCtor) return 'set';
  if (isView(raw) && !(raw instanceof DataView)) return 'typed';
  if (raw instanceof DateCtor) return 'date';
  if (raw instanceof RegExpCtor) return 'regexp';
  if (raw instanceof ErrorCtor) return 'error';
  if (raw instanceof Promise || raw instanceof WeakMap || raw instanceof WeakSet || raw instanceof ArrayBuffer ||
    raw instanceof DataView) return 'other';
  // generators, iterators, WeakRef, Intl… carry internal slots that a Proxy would break
  if (hasBuiltinTag(raw)) return 'other';
  return 'object';
}

function hasBuiltinTag(raw: object): boolean {
  for (let p: object | null = raw; p && p !== Object.prototype; p = getPrototypeOf(p) as object | null) {
    const d = getOwnPropertyDescriptor(p, Symbol.toStringTag);
    if (d) return true;
  }
  return false;
}

export function classNameOf(raw: object): string | undefined {
  const proto = getPrototypeOf(raw) as object | null;
  if (!proto || proto === Object.prototype || proto === Array.prototype) return undefined;
  const d = getOwnPropertyDescriptor(proto, 'constructor');
  const ctor = d && 'value' in d ? (d.value as { name?: string } | undefined) : undefined;
  const name = ctor && typeof ctor.name === 'string' ? ctor.name : undefined;
  if (!name || name === 'Map' || name === 'Set' || name === 'Object') return undefined;
  return name;
}

export class Registry {
  private readonly ids = new WeakMapCtor<object, number>();
  private nextId = 1;
  private readonly strIds = new MapCtor<string, number>();
  private nextStr = 1;
  private count = 0;
  private readonly emitter: Emitter;
  private readonly unwrap: (v: unknown) => unknown;

  constructor(emitter: Emitter, unwrap: (v: unknown) => unknown) {
    this.emitter = emitter;
    this.unwrap = unwrap;
  }

  idOf(raw: object): number | undefined {
    return this.ids.get(raw);
  }

  ser(v: unknown): V {
    switch (typeof v) {
      case 'number':
        if (numberIsNaN(v)) return { n: 'NaN' };
        if (v === Infinity) return { n: 'Inf' };
        if (v === -Infinity) return { n: '-Inf' };
        if (objectIs(v, -0)) return { n: '-0' };
        return v;
      case 'string':
        return v.length >= INTERN_MIN ? { s: this.intern(v) } : v;
      case 'boolean':
        return v;
      case 'undefined':
        return UNDEF;
      case 'bigint':
        return { big: v.toString() };
      case 'symbol':
        return { sym: v.description ?? '' };
      case 'function':
        return { fn: (v as { name?: string }).name || 'anonymous' };
      default: {
        if (v === null) return null;
        const id = this.register(this.unwrap(v) as object);
        return id ? { r: id } : { trunc: 0 };
      }
    }
  }

  private intern(s: string): number {
    const existing = this.strIds.get(s);
    if (existing) return existing;
    const id = this.nextStr++;
    this.strIds.set(s, id);
    this.emitter.emit({ t: 'str', id, value: s.length > MAX_STRING ? stringSlice(s, 0, MAX_STRING) : s });
    return id;
  }

  /** Assign ids to `root` and every not-yet-registered object reachable from it, then emit their allocs. */
  register(root: object): number {
    const existing = this.ids.get(root);
    if (existing) return existing;
    if (this.count >= MAX_OBJECTS) return 0;
    const order: object[] = [];
    const stack: object[] = [root];
    this.assign(root);
    while (stack.length) {
      const obj = stack[stack.length - 1];
      stack.length -= 1;
      order[order.length] = obj;
      this.forEachChild(obj, (child) => {
        const c = this.unwrap(child) as object;
        if (!this.ids.has(c) && this.count < MAX_OBJECTS) {
          this.assign(c);
          stack[stack.length] = c;
        }
      });
    }
    for (const obj of order) {
      this.emitter.emit({ t: 'alloc', id: this.ids.get(obj) as number, data: this.serialize(obj) });
    }
    return this.ids.get(root) as number;
  }

  private assign(obj: object): void {
    this.ids.set(obj, this.nextId++);
    this.count += 1;
  }

  private forEachChild(obj: object, visit: (child: object) => void): void {
    const isObj = (v: unknown): v is object => v !== null && typeof v === 'object';
    const kind = heapKindOf(obj);
    if (kind === 'array') {
      const arr = obj as unknown[];
      const n = Math.min(arr.length, MAX_ELEMS);
      for (let i = 0; i < n; i++) {
        const d = getOwnPropertyDescriptor(arr, i);
        if (d && 'value' in d && isObj(d.value)) visit(d.value);
      }
    } else if (kind === 'map') {
      let i = 0;
      for (const [k, v] of { [Symbol.iterator]: () => mapEntries(obj) }) {
        if (i++ >= MAX_ELEMS) break;
        if (isObj(k)) visit(k);
        if (isObj(v)) visit(v);
      }
    } else if (kind === 'set') {
      let i = 0;
      for (const v of { [Symbol.iterator]: () => setValues(obj) }) {
        if (i++ >= MAX_ELEMS) break;
        if (isObj(v)) visit(v);
      }
    } else if (kind === 'object') {
      const keys = objectKeys(obj);
      const n = Math.min(keys.length, MAX_PROPS);
      for (let i = 0; i < n; i++) {
        const d = getOwnPropertyDescriptor(obj, keys[i]);
        if (d && 'value' in d && isObj(d.value)) visit(d.value);
      }
    }
  }

  serialize(obj: object): SerializedObj {
    const kind = heapKindOf(obj);
    const cls = classNameOf(obj);
    switch (kind) {
      case 'array': {
        const arr = obj as unknown[];
        const n = Math.min(arr.length, MAX_ELEMS);
        const elems: V[] = new Array(n);
        for (let i = 0; i < n; i++) {
          const d = getOwnPropertyDescriptor(arr, i);
          elems[i] = !d ? { hole: 1 } : 'value' in d ? this.ser(d.value) : { fn: 'get' };
        }
        return cls ? { kind, cls, elems, length: arr.length } : { kind, elems, length: arr.length };
      }
      case 'typed': {
        const ta = obj as unknown as ArrayLike<number | bigint>;
        const n = Math.min(ta.length, MAX_ELEMS);
        const elems: V[] = new Array(n);
        for (let i = 0; i < n; i++) elems[i] = this.ser(ta[i]);
        return { kind, cls: (obj as { constructor?: { name?: string } }).constructor?.name, elems, length: ta.length };
      }
      case 'map': {
        const entries: [V, V][] = [];
        for (const [k, v] of { [Symbol.iterator]: () => mapEntries(obj) }) {
          if (entries.length >= MAX_ELEMS) break;
          entries[entries.length] = [this.ser(k), this.ser(v)];
        }
        return cls ? { kind, cls, entries } : { kind, entries };
      }
      case 'set': {
        const values: V[] = [];
        for (const v of { [Symbol.iterator]: () => setValues(obj) }) {
          if (values.length >= MAX_ELEMS) break;
          values[values.length] = this.ser(v);
        }
        return cls ? { kind, cls, values } : { kind, values };
      }
      case 'date': {
        const time = (obj as Date).getTime();
        return { kind, text: numberIsNaN(time) ? 'Invalid Date' : (obj as Date).toISOString() };
      }
      case 'regexp':
        return { kind, text: String(obj) };
      case 'error': {
        const d = getOwnPropertyDescriptor(obj, 'message');
        return { kind, cls: cls ?? 'Error', text: d && 'value' in d ? String(d.value) : '' };
      }
      case 'other':
        return { kind, cls };
      default: {
        const keys = objectKeys(obj);
        const n = Math.min(keys.length, MAX_PROPS);
        const props: [string, V][] = [];
        for (let i = 0; i < n; i++) {
          const d = getOwnPropertyDescriptor(obj, keys[i]);
          if (!d) continue;
          props[props.length] = [keys[i], 'value' in d ? this.ser(d.value) : { fn: 'get' }];
        }
        return cls ? { kind: 'object', cls, props } : { kind: 'object', props };
      }
    }
  }
}
