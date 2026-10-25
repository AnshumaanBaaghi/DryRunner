/** console.log-style formatting of raw runtime values (never invokes getters; depth/size limited). */
import { classNameOf, heapKindOf } from './registry';
import { getOwnPropertyDescriptor, mapEntries, objectKeys, setValues } from './primordials';

const MAX_ITEMS = 50;
const MAX_DEPTH = 3;
const MAX_TEXT = 2_000;

function formatPrimitive(v: unknown, quote: boolean): string {
  switch (typeof v) {
    case 'string':
      return quote ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'` : v;
    case 'bigint':
      return `${v}n`;
    case 'symbol':
      return v.toString();
    case 'function':
      return `[Function: ${(v as { name?: string }).name || 'anonymous'}]`;
    case 'number':
      return Object.is(v, -0) ? '-0' : String(v);
    default:
      return String(v);
  }
}

export function formatValue(v: unknown, unwrap: (x: unknown) => unknown, quote = true, depth = 0, seen = new Set<object>()): string {
  if (v === null || typeof v !== 'object') return formatPrimitive(v, quote);
  const raw = unwrap(v) as object;
  if (seen.has(raw)) return '[Circular]';
  const kind = heapKindOf(raw);
  const cls = classNameOf(raw);
  if (kind === 'date') return Number.isNaN((raw as Date).getTime()) ? 'Invalid Date' : (raw as Date).toISOString();
  if (kind === 'regexp') return String(raw);
  if (kind === 'error') {
    const d = getOwnPropertyDescriptor(raw, 'message');
    return `${cls ?? 'Error'}: ${d && 'value' in d ? String(d.value) : ''}`;
  }
  if (depth >= MAX_DEPTH) {
    if (kind === 'array') return '[Array]';
    return cls ? `[${cls}]` : '[Object]';
  }
  seen.add(raw);
  const inner = (x: unknown) => formatValue(x, unwrap, true, depth + 1, seen);
  try {
    if (kind === 'array' || kind === 'typed') {
      const arr = raw as ArrayLike<unknown>;
      const n = Math.min(arr.length, MAX_ITEMS);
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const d = getOwnPropertyDescriptor(arr, i);
        parts.push(!d ? '<empty>' : 'value' in d ? inner(d.value) : '[Getter]');
      }
      if (arr.length > n) parts.push(`… ${arr.length - n} more`);
      const prefix = kind === 'typed' ? `${(raw as { constructor?: { name?: string } }).constructor?.name ?? 'TypedArray'}(${arr.length}) ` : '';
      return `${prefix}[${parts.join(', ')}]`;
    }
    if (kind === 'map') {
      const parts: string[] = [];
      let size = 0;
      for (const [k, val] of { [Symbol.iterator]: () => mapEntries(raw) }) {
        size += 1;
        if (parts.length < MAX_ITEMS) parts.push(`${inner(k)} => ${inner(val)}`);
      }
      return `Map(${size}) {${parts.length ? ` ${parts.join(', ')} ` : ''}}`;
    }
    if (kind === 'set') {
      const parts: string[] = [];
      let size = 0;
      for (const val of { [Symbol.iterator]: () => setValues(raw) }) {
        size += 1;
        if (parts.length < MAX_ITEMS) parts.push(inner(val));
      }
      return `Set(${size}) {${parts.length ? ` ${parts.join(', ')} ` : ''}}`;
    }
    const keys = objectKeys(raw);
    const parts: string[] = [];
    for (const k of keys.slice(0, MAX_ITEMS)) {
      const d = getOwnPropertyDescriptor(raw, k);
      if (!d) continue;
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`;
      parts.push(`${key}: ${'value' in d ? inner(d.value) : '[Getter]'}`);
    }
    if (keys.length > MAX_ITEMS) parts.push(`… ${keys.length - MAX_ITEMS} more`);
    const body = parts.length ? `{ ${parts.join(', ')} }` : '{}';
    return cls ? `${cls} ${body}` : body;
  } finally {
    seen.delete(raw);
  }
}

/** Browser-like console line: strings print raw, `%s/%d/%i/%f/%o/%O/%j` substitution on a leading string. */
export function formatLogLine(args: unknown[], unwrap: (x: unknown) => unknown): string {
  const out: string[] = [];
  let rest = args;
  if (typeof args[0] === 'string' && /%[sdifoOj%]/.test(args[0])) {
    let i = 1;
    const first = args[0].replace(/%([sdifoOj%])/g, (match, spec: string) => {
      if (spec === '%') return '%';
      if (i >= args.length) return match;
      const a = args[i++];
      switch (spec) {
        case 's': return typeof a === 'string' ? a : formatValue(a, unwrap, false);
        case 'd':
        case 'i': return String(Math.trunc(Number(a)));
        case 'f': return String(Number(a));
        default: return formatValue(a, unwrap, true);
      }
    });
    out.push(first);
    rest = args.slice(i);
  }
  for (const a of rest) out.push(formatValue(a, unwrap, false));
  const text = out.join(' ');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** The `console` user code sees: every method records a log event through `log`. */
export function makeConsole(log: (level: LogLevel, args: unknown[]) => void): Record<string, (...args: unknown[]) => void> {
  const at = (level: LogLevel) => (...args: unknown[]) => log(level, args);
  return {
    log: at('log'), info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'),
    table: at('log'), dir: at('log'), trace: at('log'),
    assert: (cond: unknown, ...args: unknown[]) => {
      if (!cond) log('error', ['Assertion failed:', ...args]);
    },
  };
}
