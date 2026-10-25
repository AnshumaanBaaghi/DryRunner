/**
 * Watch expressions / conditional breakpoints, evaluated against a recorded snapshot (never re-runs code).
 * A small jsep AST interpreter with an allowlist of pure methods: it cannot loop, mutate or hang.
 */
import jsep from 'jsep';
import { formatValue } from '../runtime/format';
import { frameById, scopeChain, visibleVars } from '../timeline/scope';
import type { Snapshot, Timeline } from '../timeline/types';
import { materialize } from '../timeline/values';

jsep.addUnaryOp('typeof');
jsep.addBinaryOp('in', 7);

export type WatchResult = { ok: true; value: unknown; display: string } | { ok: false; error: string };

type Node = jsep.Expression;

const MAX_OPS = 5_000;
const MAX_STRING = 20_000;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__']);

const ARRAY_METHODS = new Set(['at', 'slice', 'includes', 'indexOf', 'lastIndexOf', 'join', 'concat', 'flat', 'toString']);
const STRING_METHODS = new Set([
  'at', 'charAt', 'charCodeAt', 'codePointAt', 'slice', 'substring', 'substr', 'includes', 'indexOf', 'lastIndexOf',
  'startsWith', 'endsWith', 'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'split', 'repeat', 'padStart',
  'padEnd', 'localeCompare', 'concat', 'toString',
]);
const MAP_METHODS = new Set(['get', 'has', 'keys', 'values', 'entries']);
const SET_METHODS = new Set(['has', 'values', 'keys', 'entries']);
const NUMBER_METHODS = new Set(['toFixed', 'toString', 'toPrecision']);

const SAFE_GLOBALS: Record<string, unknown> = {
  Math,
  Infinity,
  NaN,
  undefined,
  Number: { isInteger: Number.isInteger, isFinite: Number.isFinite, isNaN: Number.isNaN, parseInt: Number.parseInt, parseFloat: Number.parseFloat, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER, MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER },
  Object: { keys: Object.keys, values: Object.values, entries: Object.entries },
  JSON: { stringify: (v: unknown) => { const s = JSON.stringify(v); return s && s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s; } },
  Array: { isArray: Array.isArray, from: (v: unknown) => (typeof v === 'string' || Array.isArray(v) || v instanceof Map || v instanceof Set ? Array.from(v as Iterable<unknown>) : []) },
  String: (v: unknown) => String(v),
  Boolean: (v: unknown) => Boolean(v),
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
};
const NUMBER_FN = (v: unknown) => Number(v);
Object.assign(NUMBER_FN, SAFE_GLOBALS.Number as object);
SAFE_GLOBALS.Number = NUMBER_FN;

const SAFE_STATIC_FNS = new Set<unknown>([
  // Math's methods are non-enumerable, so Object.values(Math) would miss them
  ...Object.getOwnPropertyNames(Math).map((k) => (Math as unknown as Record<string, unknown>)[k]).filter((v) => typeof v === 'function'),
  ...Object.values(SAFE_GLOBALS.Object as object), ...Object.values(SAFE_GLOBALS.JSON as object), ...Object.values(SAFE_GLOBALS.Array as object),
  Number.isInteger, Number.isFinite, Number.isNaN, Number.parseInt, Number.parseFloat, SAFE_GLOBALS.String, SAFE_GLOBALS.Boolean, NUMBER_FN,
  parseInt, parseFloat, isNaN, isFinite,
]);

class EvalError extends Error {}

interface Ctx {
  lookup(name: string): { found: boolean; value: unknown };
  ops: number;
}

function capArgs(name: string, args: unknown[]): unknown[] {
  if ((name === 'repeat' || name === 'padStart' || name === 'padEnd') && Number(args[0]) > MAX_STRING) {
    throw new EvalError(`${name} count too large`);
  }
  return args;
}

function callMethod(obj: unknown, name: string, args: unknown[]): unknown {
  if (BLOCKED.has(name)) throw new EvalError(`"${name}" is not allowed`);
  if (Array.isArray(obj) && ARRAY_METHODS.has(name)) return (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
  if (typeof obj === 'string' && STRING_METHODS.has(name)) return (String.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[name].apply(obj, capArgs(name, args));
  if (obj instanceof Map && MAP_METHODS.has(name)) {
    const r = (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
    return name === 'get' || name === 'has' ? r : [...(r as Iterable<unknown>)];
  }
  if (obj instanceof Set && SET_METHODS.has(name)) {
    const r = (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
    return name === 'has' ? r : [...(r as Iterable<unknown>)];
  }
  if (typeof obj === 'number' && NUMBER_METHODS.has(name)) return (Number.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[name].apply(obj, args);
  if (obj !== null && typeof obj === 'object') {
    const fn = (obj as Record<string, unknown>)[name];
    if (SAFE_STATIC_FNS.has(fn)) return (fn as (...a: unknown[]) => unknown)(...args);
  }
  throw new EvalError(`${name}() is not available in watch expressions`);
}

function member(obj: unknown, key: unknown, optional: boolean): unknown {
  if (obj === null || obj === undefined) {
    if (optional) return undefined;
    throw new EvalError(`Cannot read properties of ${obj} (reading '${String(key)}')`);
  }
  const k = String(key);
  if (BLOCKED.has(k)) throw new EvalError(`"${k}" is not allowed`);
  if (obj instanceof Map && k === 'size') return obj.size;
  if (obj instanceof Set && k === 'size') return obj.size;
  if (typeof obj === 'string') return k === 'length' ? obj.length : /^\d+$/.test(k) ? obj[Number(k)] : undefined;
  if (Array.isArray(obj) && k === 'length') return obj.length;
  // own data only: inherited members (prototype methods) are reachable solely through callMethod's allowlist
  if (typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k)) return (obj as Record<string, unknown>)[k];
  return undefined;
}

function binary(op: string, a: unknown, b: unknown): unknown {
  const x = a as number;
  const y = b as number;
  switch (op) {
    case '+': return (x as unknown as string) + (y as unknown as string);
    case '-': return x - y;
    case '*': return x * y;
    case '/': return x / y;
    case '%': return x % y;
    case '**': return x ** y;
    case '==': return a == b;
    case '!=': return a != b;
    case '===': return a === b;
    case '!==': return a !== b;
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    case '>=': return x >= y;
    case '&': return x & y;
    case '|': return x | y;
    case '^': return x ^ y;
    case '<<': return x << y;
    case '>>': return x >> y;
    case '>>>': return x >>> y;
    case 'in': {
      if (b instanceof Map || b instanceof Set) throw new EvalError(`'in' checks properties; use .has() for ${b instanceof Map ? 'Map' : 'Set'}`);
      return b !== null && typeof b === 'object' ? String(a) in (b as object) : false;
    }
    default: throw new EvalError(`Operator ${op} is not supported`);
  }
}

function evalNode(node: Node, ctx: Ctx): unknown {
  ctx.ops += 1;
  if (ctx.ops > MAX_OPS) throw new EvalError('Expression too expensive');
  switch (node.type) {
    case 'Literal':
      return (node as jsep.Literal).value;
    case 'Identifier': {
      const name = (node as jsep.Identifier).name;
      const r = ctx.lookup(name);
      if (r.found) return r.value;
      if (Object.prototype.hasOwnProperty.call(SAFE_GLOBALS, name)) return SAFE_GLOBALS[name];
      throw new EvalError(`${name} is not defined here`);
    }
    case 'ThisExpression':
      return undefined;
    case 'ArrayExpression':
      return (node as jsep.ArrayExpression).elements.map((e) => (e ? evalNode(e, ctx) : undefined));
    case 'Compound': {
      let v: unknown;
      for (const n of (node as jsep.Compound).body) v = evalNode(n, ctx);
      return v;
    }
    case 'UnaryExpression': {
      const u = node as jsep.UnaryExpression;
      if (u.operator === 'typeof') {
        if (u.argument.type === 'Identifier' && !ctx.lookup((u.argument as jsep.Identifier).name).found) return 'undefined';
        const v = evalNode(u.argument, ctx);
        return v instanceof Map || v instanceof Set || Array.isArray(v) ? 'object' : typeof v;
      }
      const v = evalNode(u.argument, ctx) as number;
      switch (u.operator) {
        case '-': return -v;
        case '+': return +v;
        case '!': return !v;
        case '~': return ~v;
        default: throw new EvalError(`Operator ${u.operator} is not supported`);
      }
    }
    case 'BinaryExpression': {
      const b = node as jsep.BinaryExpression;
      if (b.operator === '&&') return evalNode(b.left, ctx) && evalNode(b.right, ctx);
      if (b.operator === '||') return evalNode(b.left, ctx) || evalNode(b.right, ctx);
      if (b.operator === '??') return evalNode(b.left, ctx) ?? evalNode(b.right, ctx);
      const left = evalNode(b.left, ctx);
      const right = evalNode(b.right, ctx);
      const r = binary(b.operator, left, right);
      if (typeof r === 'string' && r.length > MAX_STRING) throw new EvalError('Result too large');
      return r;
    }
    case 'ConditionalExpression': {
      const c = node as jsep.ConditionalExpression;
      return evalNode(c.test, ctx) ? evalNode(c.consequent, ctx) : evalNode(c.alternate, ctx);
    }
    case 'MemberExpression': {
      const m = node as jsep.MemberExpression & { optional?: boolean };
      const obj = evalNode(m.object, ctx);
      const key = m.computed ? evalNode(m.property, ctx) : (m.property as jsep.Identifier).name;
      return member(obj, key, Boolean(m.optional));
    }
    case 'CallExpression': {
      const c = node as jsep.CallExpression;
      const args = c.arguments.map((a) => evalNode(a, ctx));
      if (c.callee.type === 'MemberExpression') {
        const m = c.callee as jsep.MemberExpression & { optional?: boolean };
        const obj = evalNode(m.object, ctx);
        if ((obj === null || obj === undefined) && m.optional) return undefined;
        const name = m.computed ? String(evalNode(m.property, ctx)) : (m.property as jsep.Identifier).name;
        return callMethod(obj, name, args);
      }
      const fn = evalNode(c.callee, ctx);
      if (SAFE_STATIC_FNS.has(fn)) return (fn as (...a: unknown[]) => unknown)(...args);
      throw new EvalError('Only built-in helpers can be called in watch expressions');
    }
    default:
      throw new EvalError(`${node.type} is not supported in watch expressions`);
  }
}

export function makeLookup(tl: Timeline, snap: Snapshot, callId: number): Ctx['lookup'] {
  const frame = frameById(snap, callId) ?? (snap.frames.last() as NonNullable<ReturnType<typeof frameById>>);
  const chain = frame ? scopeChain(snap, frame) : [];
  const cache = new Map<number, unknown>();
  return (name: string) => {
    for (const f of chain) {
      const v = visibleVars(tl, f, { includeFunctions: false }).find((x) => x.name === name);
      if (v) return { found: true, value: materialize(tl, snap, v.slot.v, cache) };
    }
    return { found: false, value: undefined };
  };
}

export function parseWatch(expr: string): { ok: true; ast: Node } | { ok: false; error: string } {
  try {
    return { ok: true, ast: jsep(expr) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Evaluate `expr` in the frame `callId` (default: the step's own frame) at step `step`. */
export function evaluateWatch(tl: Timeline, step: number, expr: string, callId?: number): WatchResult {
  const snap = tl.snapshots[step];
  if (!snap) return { ok: false, error: 'No such step' };
  const parsed = parseWatch(expr);
  if (!parsed.ok) return parsed;
  const frameId = callId ?? tl.steps[step]?.callId ?? 0;
  const ctx: Ctx = { lookup: makeLookup(tl, snap, frameId), ops: 0 };
  try {
    const value = evalNode(parsed.ast, ctx);
    return { ok: true, value, display: formatValue(value, (x) => x) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
