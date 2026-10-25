/** Encoded runtime values as they travel in the trace (structured-clone and JSON safe). */

export type ObjId = number;
export type StrId = number;

export type V =
  | number
  | string
  | boolean
  | null
  | { u: 1 } // undefined
  | { n: 'NaN' | 'Inf' | '-Inf' | '-0' }
  | { big: string }
  | { sym: string }
  | { fn: string } // function (by name)
  | { r: ObjId } // heap reference
  | { s: StrId } // interned long string
  | { hole: 1 } // array hole
  | { trunc: number }; // value omitted (budget); payload = count/length when known

export const UNDEF: V = { u: 1 };

export function isRef(v: V | undefined): v is { r: ObjId } {
  return typeof v === 'object' && v !== null && 'r' in v;
}

export function isUndef(v: V | undefined): boolean {
  return typeof v === 'object' && v !== null && 'u' in v;
}

/** Structural equality for encoded values (NaN equals NaN, -0 differs from 0 by encoding). */
export function sameV(a: V | undefined, b: V | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== 1 || kb.length !== 1 || ka[0] !== kb[0]) return false;
  const k = ka[0] as keyof typeof a;
  return (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k];
}

export type HeapKind = 'array' | 'object' | 'map' | 'set' | 'typed' | 'date' | 'regexp' | 'error' | 'other';

/** Shallow serialized heap object carried by `alloc` events. Nested objects appear as refs. */
export interface SerializedObj {
  kind: HeapKind;
  cls?: string;
  elems?: V[];
  length?: number;
  props?: [string, V][];
  entries?: [V, V][];
  values?: V[];
  text?: string;
}
