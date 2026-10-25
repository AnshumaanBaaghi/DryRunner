/** Reading encoded values against a snapshot: previews for UI text and materialized JS values for watches. */
import type { V } from '../types/values';
import { orderedEntries, orderedProps } from './heap';
import type { HeapObj, Snapshot, Timeline } from './types';

export function isObj(v: V | undefined): v is Exclude<V, number | string | boolean | null> {
  return typeof v === 'object' && v !== null;
}

export function refId(v: V | undefined): number | null {
  return isObj(v) && 'r' in v ? v.r : null;
}

export function isFnValue(v: V | undefined): boolean {
  return isObj(v) && 'fn' in v;
}

export function deref(snap: Snapshot, v: V | undefined): HeapObj | undefined {
  const id = refId(v);
  return id === null ? undefined : snap.heap.get(id);
}

/** Decode a primitive (or interned string); objects return undefined. */
export function primitive(tl: Timeline, v: V | undefined): { ok: boolean; value: unknown } {
  if (v === undefined) return { ok: true, value: undefined };
  if (!isObj(v)) return { ok: true, value: v };
  if ('u' in v) return { ok: true, value: undefined };
  if ('n' in v) return { ok: true, value: v.n === 'NaN' ? NaN : v.n === 'Inf' ? Infinity : v.n === '-Inf' ? -Infinity : -0 };
  if ('big' in v) return { ok: true, value: BigInt(v.big) };
  if ('s' in v) return { ok: true, value: tl.strings.get(v.s) ?? '' };
  if ('hole' in v) return { ok: true, value: undefined };
  return { ok: false, value: undefined };
}

export function isNumberV(tl: Timeline, v: V | undefined): v is number {
  const p = primitive(tl, v);
  return p.ok && typeof p.value === 'number';
}

const quote = (s: string, max: number) => {
  const cut = s.length > max ? `${s.slice(0, max)}…` : s;
  return `'${cut.replace(/\n/g, '\\n')}'`;
};

export interface PreviewOptions {
  depth?: number;
  maxItems?: number;
  maxString?: number;
}

export function previewValue(tl: Timeline, snap: Snapshot, v: V | undefined, opts: PreviewOptions = {}): string {
  const depth = opts.depth ?? 1;
  const maxItems = opts.maxItems ?? 8;
  const maxString = opts.maxString ?? 40;
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'string') return quote(v, maxString);
  if (typeof v === 'boolean') return String(v);
  if ('u' in v) return 'undefined';
  if ('n' in v) return v.n === 'Inf' ? 'Infinity' : v.n === '-Inf' ? '-Infinity' : v.n;
  if ('big' in v) return `${v.big}n`;
  if ('sym' in v) return `Symbol(${v.sym})`;
  if ('fn' in v) return `ƒ ${v.fn}`;
  if ('hole' in v) return 'empty';
  if ('trunc' in v) return '…';
  if ('s' in v) return quote(tl.strings.get(v.s) ?? '', maxString);
  const obj = snap.heap.get(v.r);
  if (!obj) return '{…}';
  return previewObject(tl, snap, obj, depth, maxItems, maxString);
}

export function previewObject(tl: Timeline, snap: Snapshot, obj: HeapObj, depth: number, maxItems: number, maxString: number): string {
  const inner = (x: V | undefined) => previewValue(tl, snap, x, { depth: depth - 1, maxItems: Math.max(3, maxItems >> 1), maxString });
  switch (obj.kind) {
    case 'array':
    case 'typed': {
      const elems = obj.elems?.toArray() ?? [];
      const n = obj.length ?? elems.length;
      const prefix = obj.kind === 'typed' ? `${obj.cls ?? 'TypedArray'}(${n}) ` : '';
      if (depth <= 0) return `${prefix}[…${n}]`;
      const shown = elems.slice(0, maxItems).map(inner);
      if (n > shown.length) shown.push(`…+${n - shown.length}`);
      return `${prefix}[${shown.join(', ')}]`;
    }
    case 'map':
    case 'set': {
      const entries = orderedEntries(obj);
      const label = `${obj.cls ?? (obj.kind === 'map' ? 'Map' : 'Set')}(${entries.length})`;
      if (depth <= 0) return label;
      const shown = entries.slice(0, maxItems).map((e) => (obj.kind === 'map' ? `${inner(e.k)} => ${inner(e.v)}` : inner(e.v)));
      if (entries.length > shown.length) shown.push('…');
      return `${label} {${shown.join(', ')}}`;
    }
    case 'date':
    case 'regexp':
      return obj.text ?? obj.kind;
    case 'error':
      return `${obj.cls ?? 'Error'}: ${obj.text ?? ''}`;
    case 'other':
      return obj.cls ? `${obj.cls} {…}` : '{…}';
    default: {
      const props = orderedProps(obj);
      if (depth <= 0) return obj.cls ? `${obj.cls}{…}` : '{…}';
      const shown = props.slice(0, maxItems).map(([k, slot]) => `${k}: ${inner(slot.v)}`);
      if (props.length > shown.length) shown.push('…');
      const body = `{${shown.join(', ')}}`;
      return obj.cls ? `${obj.cls} ${body}` : body;
    }
  }
}

const MAX_MATERIALIZE = 10_000;

/** Snapshot value → plain JS (arrays, objects, Map, Set) for the watch evaluator; cycles preserved. */
export function materialize(tl: Timeline, snap: Snapshot, v: V | undefined, cache = new Map<number, unknown>(), budget = { left: MAX_MATERIALIZE }): unknown {
  const p = primitive(tl, v);
  if (p.ok) return p.value;
  if (!isObj(v)) return v;
  if ('fn' in v) return undefined;
  if ('sym' in v) return Symbol(v.sym);
  if (!('r' in v)) return undefined;
  if (cache.has(v.r)) return cache.get(v.r);
  const obj = snap.heap.get(v.r);
  if (!obj || budget.left <= 0) return undefined;
  budget.left -= 1;
  const recur = (x: V | undefined) => materialize(tl, snap, x, cache, budget);
  switch (obj.kind) {
    case 'array':
    case 'typed': {
      const out: unknown[] = [];
      cache.set(v.r, out);
      for (const e of obj.elems ?? []) out.push(recur(e));
      return out;
    }
    case 'map': {
      const out = new Map<unknown, unknown>();
      cache.set(v.r, out);
      for (const e of orderedEntries(obj)) out.set(recur(e.k), recur(e.v));
      return out;
    }
    case 'set': {
      const out = new Set<unknown>();
      cache.set(v.r, out);
      for (const e of orderedEntries(obj)) out.add(recur(e.v));
      return out;
    }
    case 'date':
      return obj.text ? new Date(obj.text) : new Date(NaN);
    default: {
      const out: Record<string, unknown> = {};
      cache.set(v.r, out);
      for (const [k, slot] of orderedProps(obj)) out[k] = recur(slot.v);
      return out;
    }
  }
}
