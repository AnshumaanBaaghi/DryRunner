/**
 * Arrays and strings indexed by integer variables. Modes:
 *  sorting (swaps / sort calls) · window (two non-decreasing positions, left trailing) · two-pointers
 *  (converging) · binary-search (lo/hi interval + mid) · pointers (plain indexing).
 * Positions are the variables used as `arr[p]` plus named bounds (left, lo, hi, …) of the same function
 * that stay inside the index range: a window's left edge or a search bound is often never an index itself.
 */
import { resolveVarKey, type ObjInfo, type TraceAnalysis, type VarInfo } from '../../engine/detect/analysis';
import { trackVar, varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { primitive } from '../../engine/timeline/values';
import type { DetectContext, Detection } from '../types';

export type PointerRole = 'pointer' | 'left' | 'right' | 'lo' | 'hi' | 'mid';
export type ArrayMode = 'sorting' | 'window' | 'two-pointers' | 'binary-search' | 'pointers' | 'plain';

export interface ArrayBindings {
  target: VarRef;
  /** heap object (absent for strings) */
  objId?: number;
  isString: boolean;
  pointers: { ref: VarRef; role: PointerRole }[];
  window?: { left: VarRef; right: VarRef };
  interval?: { lo: VarRef; hi: VarRef; mid?: VarRef };
  /** two pointers: elements outside [left, right] are already ruled out */
  span?: { left: VarRef; right: VarRef };
}

const LEFTISH = /^(l|lo|low|left|start|begin|slow|i|p1|a)$/;
const RIGHTISH = /^(r|hi|high|right|end|fast|j|p2|b)$/;
const MIDISH = /^(m|mid|middle|pivot)$/;
/** bounds accepted as positions even when never used as an index */
const BOUND = /^(l|lo|low|left|start|begin|r|hi|high|right|end)$/;

const isIntVar = (v: VarInfo) => v.kinds.has('int') && [...v.kinds].every((k) => k === 'int' || k === 'undefined' || k === 'null');

function arrayObjects(info: VarInfo, a: TraceAnalysis): ObjInfo[] {
  return [...info.heapIds]
    .map((id) => a.objects.get(id))
    .filter((o): o is ObjInfo => Boolean(o) && (o!.kind === 'array' || o!.kind === 'typed') && !o!.nested);
}

const trendCache = new WeakMap<Timeline, Map<string, { ups: number; downs: number }>>();

/** Value direction changes across the whole trace (a loop variable re-declared lower counts as going down). */
function trend(tl: Timeline, ref: VarRef): { ups: number; downs: number } {
  let byKey = trendCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    trendCache.set(tl, byKey);
  }
  const key = varKey(ref);
  const hit = byKey.get(key);
  if (hit) return hit;
  let ups = 0;
  let downs = 0;
  let prev: number | null = null;
  for (const v of trackVar(tl, ref)) {
    if (typeof v !== 'number') continue;
    if (prev !== null && v > prev) ups += 1;
    if (prev !== null && v < prev) downs += 1;
    prev = v;
  }
  const t = { ups, downs };
  byKey.set(key, t);
  return t;
}

const rising = (tl: Timeline, v: VarInfo) => {
  const t = trend(tl, v.ref);
  return t.ups > 0 && t.downs === 0;
};
const falling = (tl: Timeline, v: VarInfo) => {
  const t = trend(tl, v.ref);
  return t.downs > 0 && t.ups === 0;
};

/** How often `a`'s value stays ≤ `b`'s across the trace (both defined). */
function orderRatio(tl: Timeline, a: VarRef, b: VarRef): number {
  const va = trackVar(tl, a);
  const vb = trackVar(tl, b);
  let le = 0;
  let total = 0;
  for (let i = 0; i < va.length; i++) {
    if (typeof va[i] !== 'number' || typeof vb[i] !== 'number') continue;
    total += 1;
    if ((va[i] as number) <= (vb[i] as number)) le += 1;
  }
  return total ? le / total : 0.5;
}

/** Integer variables used as `name[idx]` for this array, and the functions doing the indexing. */
function indexVarsFor(key: string, name: string, ctx: DetectContext): { vars: VarInfo[]; fnIds: Set<number> } {
  const { analysis: a, tl } = ctx;
  const out = new Map<string, VarInfo>();
  const fnIds = new Set<number>();
  for (const u of tl.meta.analysis.indexUsage) {
    if (u.object !== name) continue;
    if (resolveVarKey(a, u.object, u.fnId) !== key) continue;
    fnIds.add(u.fnId);
    const pk = resolveVarKey(a, u.index, u.fnId);
    const pv = pk ? a.vars.get(pk) : undefined;
    if (pv && isIntVar(pv)) out.set(pk as string, pv);
  }
  return { vars: [...out.values()], fnIds };
}

function maxLength(tl: Timeline, info: VarInfo, obj: ObjInfo | undefined): number {
  if (obj) return obj.maxLen;
  let n = 0;
  for (const v of trackVar(tl, info.ref)) {
    const p = primitive(tl, v);
    if (typeof p.value === 'string') n = Math.max(n, p.value.length);
  }
  return n;
}

/** Named bounds in the indexing functions whose values stay within [-1, length]. */
function boundVars(ctx: DetectContext, fnIds: Set<number>, length: number, exclude: VarInfo[]): VarInfo[] {
  const out: VarInfo[] = [];
  for (const info of ctx.analysis.vars.values()) {
    if (exclude.includes(info) || !fnIds.has(info.ref.fnId) || !BOUND.test(info.ref.name) || !isIntVar(info)) continue;
    if (info.min < -1 || info.max > length) continue;
    out.push(info);
  }
  return out;
}

/** Every index variable is the counter of a loop nested in another one indexing the same array. */
function nestedCounters(tl: Timeline, vars: VarInfo[]): boolean {
  if (vars.length < 2) return false;
  const loops = tl.meta.loops;
  const loopOf = (v: VarInfo) => loops.find((l) => l.fnId === v.ref.fnId && l.kind !== 'callback' && l.counters.includes(v.ref.name));
  const found = vars.map(loopOf);
  if (found.some((l) => !l)) return false;
  const within = (inner: number, outer: number) => {
    for (let p = loops[inner]?.parent ?? null; p !== null; p = loops[p]?.parent ?? null) if (p === outer) return true;
    return false;
  };
  return found.some((a) => found.some((b) => a !== b && within(b!.id, a!.id)));
}

/** First candidate whose name matches `hint`, else the first one. */
const pick = (list: VarInfo[], hint: RegExp) => list.find((v) => hint.test(v.ref.name)) ?? list[0];

interface ModeChoice {
  mode: ArrayMode;
  score: number;
  pointers: ArrayBindings['pointers'];
  window?: ArrayBindings['window'];
  interval?: ArrayBindings['interval'];
  span?: ArrayBindings['span'];
}

function chooseMode(ctx: DetectContext, obj: ObjInfo | undefined, index: VarInfo[], bounds: VarInfo[], writes: number): ModeChoice {
  const { tl } = ctx;
  const base = index.map((p) => ({ ref: p.ref, role: 'pointer' as PointerRole }));
  const rest = (...used: VarInfo[]) => base.filter((b) => !used.some((u) => u.ref === b.ref));
  if (obj && obj.numeric && (obj.swaps >= 2 || (obj.ops.sort ?? 0) > 0)) return { mode: 'sorting', score: 0.9, pointers: base };
  const all = [...index, ...bounds];
  const mid = index.find((p) => MIDISH.test(p.ref.name));
  if (mid) {
    const others = all.filter((p) => p !== mid);
    const lo = pick(others.filter((p) => rising(tl, p)), LEFTISH);
    const hi = pick(others.filter((p) => p !== lo && falling(tl, p)), RIGHTISH);
    if (lo && hi && (lo.maxJump > 1 || hi.maxJump > 1)) {
      return {
        mode: 'binary-search', score: 0.9, interval: { lo: lo.ref, hi: hi.ref, mid: mid.ref },
        pointers: [{ ref: lo.ref, role: 'lo' }, { ref: hi.ref, role: 'hi' }, { ref: mid.ref, role: 'mid' }, ...rest(lo, hi, mid)],
      };
    }
  }
  const up = all.filter((p) => rising(tl, p));
  const down = all.filter((p) => falling(tl, p));
  const byHint = (list: VarInfo[], hint: RegExp) => [...list].sort((a, b) => Number(hint.test(b.ref.name)) - Number(hint.test(a.ref.name)));
  for (const l of byHint(up, LEFTISH)) {
    for (const r of byHint(down, RIGHTISH)) {
      if (!index.includes(l) && !index.includes(r)) continue;
      if (orderRatio(tl, l.ref, r.ref) > 0.9) {
        return {
          mode: 'two-pointers', score: 0.85, span: { left: l.ref, right: r.ref },
          pointers: [{ ref: l.ref, role: 'left' }, { ref: r.ref, role: 'right' }, ...rest(l, r)],
        };
      }
    }
  }
  let best: { l: VarInfo; r: VarInfo; rank: number } | null = null;
  for (const a of up) {
    for (const b of up) {
      if (a === b || (!index.includes(a) && !index.includes(b))) continue;
      const rank = orderRatio(tl, a.ref, b.ref) + (LEFTISH.test(a.ref.name) ? 0.05 : 0) + (RIGHTISH.test(b.ref.name) ? 0.05 : 0);
      if (!best || rank > best.rank) best = { l: a, r: b, rank };
    }
  }
  if (best && best.rank > 0.9) {
    const { l, r } = best;
    return { mode: 'window', score: 0.9, window: { left: l.ref, right: r.ref }, pointers: [{ ref: l.ref, role: 'left' }, { ref: r.ref, role: 'right' }, ...rest(l, r)] };
  }
  // a read-only array walked by nested loop counters: the iteration space says more than the array
  if (writes === 0 && nestedCounters(tl, index)) return { mode: 'pointers', score: 0.15, pointers: base };
  if (index.length) return { mode: 'pointers', score: 0.6, pointers: base };
  return { mode: 'plain', score: 0.45, pointers: [] };
}

const WRITE_OPS = ['set', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'delete', 'length'];

export function detectArrays(ctx: DetectContext): Detection<ArrayBindings>[] {
  const { analysis: a } = ctx;
  const byObject = new Map<string, { key: string; info: VarInfo; obj?: ObjInfo; index: VarInfo[]; fnIds: Set<number> }>();
  for (const [key, info] of a.vars) {
    if (info.kinds.has('fn')) continue;
    const strings = info.kinds.has('string') && [...info.kinds].every((k) => k === 'string' || k === 'undefined' || k === 'null');
    const objs = arrayObjects(info, a);
    if (!strings && objs.length === 0) continue;
    if (!strings && objs.length > 3) continue; // a variable re-bound to many arrays (e.g. merge results) is not one array
    const { vars: index, fnIds } = indexVarsFor(key, info.ref.name, ctx);
    const obj = objs[0];
    const writes = obj ? (obj.ops.set ?? 0) + obj.swaps + (obj.ops.sort ?? 0) : 0;
    if (!index.length && (strings || writes === 0)) continue;
    const objKey = obj ? `obj:${obj.id}` : `str:${key}`;
    const prev = byObject.get(objKey);
    if (!prev || index.length > prev.index.length || (index.length === prev.index.length && info.assigns < prev.info.assigns)) {
      byObject.set(objKey, { key, info, obj, index: prev && prev.index.length > index.length ? prev.index : index, fnIds });
    }
  }
  const out: Detection<ArrayBindings>[] = [];
  for (const [objKey, { info, obj, index, fnIds }] of byObject) {
    const writes = obj ? WRITE_OPS.reduce((n, op) => n + (obj.ops[op] ?? 0), 0) : 0;
    const bounds = boundVars(ctx, fnIds, maxLength(ctx.tl, info, obj), index);
    const m = chooseMode(ctx, obj, index, bounds, writes);
    const claims = [objKey, varKey(info.ref), ...(obj ? [...obj.varKeys] : [])];
    out.push({
      vizId: 'array',
      key: `array:${objKey}`,
      title: info.ref.name,
      score: m.score,
      role: 'primary',
      mode: m.mode,
      claims: [...new Set(claims)],
      bindings: {
        target: info.ref, objId: obj?.id, isString: !obj, pointers: m.pointers, window: m.window, interval: m.interval, span: m.span,
      },
    });
  }
  return out;
}
