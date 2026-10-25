/** Pure per-step model of the array visualizer (testable without WebGL). */
import { valueAt } from '../../engine/detect/track';
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, primitive, refId } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import { COLORS } from '../../scene/primitives/materials';
import type { Highlight } from '../../scene/anim';
import type { ArrayBindings, PointerRole } from './detect';
import { idsAt } from './identity';

export const SPACING = 1.08;
export const MAX_BAR = 3.4;

export interface ElemModel {
  key: string;
  index: number;
  x: number;
  label: string;
  /** numeric value (bars) or null (blocks) */
  num: number | null;
  color: string;
  pulse: boolean;
}

export interface PointerModel {
  name: string;
  role: PointerRole;
  index: number;
  x: number;
  color: string;
  stack: number;
}

export interface ArrayModel {
  exists: boolean;
  length: number;
  maxLen: number;
  bars: boolean;
  maxAbs: number;
  elems: ElemModel[];
  pointers: PointerModel[];
  window: { from: number; to: number } | null;
  interval: { from: number; to: number } | null;
  delta: { index: number; text: string } | null;
  /** two elements compared (read together, not written) or swapped in this step */
  pair: { a: number; b: number; kind: 'compare' | 'swap' } | null;
  focusIndex: number | null;
}

const ROLE_COLOR: Record<PointerRole, string> = {
  pointer: COLORS.visited, left: COLORS.window, right: COLORS.window, lo: COLORS.frontier, hi: COLORS.frontier, mid: COLORS.current,
};

export const xOf = (index: number, maxLen: number) => (index - (maxLen - 1) / 2) * SPACING;

/** elements ruled out (outside a search interval or the two pointers) */
export const DIMMED = '#1a212d';

/** Element text that fits a cell: ∞ for infinities, 3 significant digits for long numbers. */
export function cellText(tl: Timeline, snap: Snapshot, v: V): string {
  const p = primitive(tl, v);
  if (typeof p.value !== 'number') return previewValue(tl, snap, v, { depth: 0, maxString: 6 });
  if (p.value === Infinity) return '∞';
  if (p.value === -Infinity) return '-∞';
  const text = String(p.value);
  if (text.length <= 6) return text;
  const short = String(Number(p.value.toPrecision(3)));
  return short.length <= 6 ? short : p.value.toExponential(1);
}

interface Scale {
  maxAbs: number;
  maxLen: number;
  lastWrite: Map<number, number>;
  sortedAtEnd: boolean;
}

const scaleCache = new WeakMap<Timeline, Map<string, Scale & { n: number }>>();

/** Stable scale across the whole trace so bars don't jump between steps. */
function scaleOf(tl: Timeline, b: ArrayBindings): Scale {
  let byKey = scaleCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    scaleCache.set(tl, byKey);
  }
  const key = `${b.objId ?? 's'}:${b.target.fnId}:${b.target.name}`;
  const hit = byKey.get(key);
  if (hit && hit.n === tl.steps.length) return hit;
  let maxAbs = 0;
  let maxLen = 0;
  const lastWrite = new Map<number, number>();
  for (let i = 0; i < tl.steps.length; i++) {
    const v = valueAt(tl, b.target, i);
    const els = elementsOf(tl, i, v);
    maxLen = Math.max(maxLen, els.length);
    for (const e of els) if (typeof e === 'number' && Number.isFinite(e)) maxAbs = Math.max(maxAbs, Math.abs(e));
    if (b.objId !== undefined) {
      for (const h of tl.diffs[i].heap) if (h.id === b.objId && h.op === 'set' && typeof h.path[0] === 'number') lastWrite.set(h.path[0], i);
    }
  }
  const final = elementsOf(tl, tl.steps.length - 1, valueAt(tl, b.target, tl.steps.length - 1));
  const sortedAtEnd = final.every((e, k) => k === 0 || (typeof e === 'number' && typeof final[k - 1] === 'number' && (final[k - 1] as number) <= e));
  const s = { maxAbs, maxLen, lastWrite, sortedAtEnd, n: tl.steps.length };
  byKey.set(key, s);
  return s;
}

/** Elements as encoded values: heap array elements or the characters of a string. */
export function elementsOf(tl: Timeline, i: number, v: V | undefined): V[] {
  if (v === undefined) return [];
  const id = refId(v);
  if (id !== null) return tl.snapshots[i].heap.get(id)?.elems?.toArray() ?? [];
  const p = primitive(tl, v);
  return typeof p.value === 'string' ? [...p.value] : [];
}

export function buildArrayModel(tl: Timeline, i: number, b: ArrayBindings, mode: string | undefined, hl: Highlight | null): ArrayModel {
  const snap = tl.snapshots[i];
  const v = valueAt(tl, b.target, i);
  const els = elementsOf(tl, i, v);
  const scale = scaleOf(tl, b);
  const maxLen = Math.max(1, scale.maxLen);
  const bars = b.isString ? false : els.length > 0 && els.every((e) => typeof e === 'number' || (typeof e === 'object' && e !== null && 'hole' in e)) && scale.maxAbs > 0;
  const objId = b.objId ?? (v !== undefined ? refId(v) : null);
  const ids = objId !== null ? idsAt(tl, objId, i) : null;

  const written = new Map<number, { old?: V; value?: V }>();
  const read = new Set<number>();
  if (hl && objId !== null) {
    for (const h of hl.diff.heap) {
      if (h.id !== objId) continue;
      if (h.op === 'set' && typeof h.path[0] === 'number') written.set(h.path[0], { old: h.old, value: h.value });
      if ((h.op === 'push' || h.op === 'unshift') && h.args?.length) {
        const at = h.op === 'push' ? (typeof h.path[0] === 'number' ? h.path[0] : els.length - 1) : 0;
        written.set(at, { value: h.args[0] });
      }
    }
    for (const r of hl.diff.reads) if (r.id === objId && typeof r.path[0] === 'number') read.add(r.path[0]);
  }

  const num = (x: V | undefined): number | null => {
    const p = primitive(tl, x);
    return typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null;
  };
  const ptrValue = (ref: ArrayBindings['pointers'][number]['ref']) => num(valueAt(tl, ref, i));
  const range = (a?: ArrayBindings['pointers'][number]['ref'], c?: ArrayBindings['pointers'][number]['ref']) => {
    if (!a || !c) return null;
    const from = ptrValue(a);
    const to = ptrValue(c);
    return from === null || to === null ? null : { from, to };
  };
  const window = range(b.window?.left, b.window?.right);
  const interval = range(b.interval?.lo, b.interval?.hi);
  const span = range(b.span?.left, b.span?.right);
  const midIdx = b.interval?.mid ? ptrValue(b.interval.mid) : null;

  const elems: ElemModel[] = els.map((e, index) => {
    let color: string = COLORS.idle;
    if (interval && (index < interval.from || index > interval.to)) color = DIMMED;
    else if (interval) color = '#4c3f78';
    if (span && (index < span.from || index > span.to)) color = DIMMED;
    if (window && index >= window.from && index <= window.to) color = '#1f5966';
    if (mode === 'sorting' && isSettled(tl, scale, index, i)) color = COLORS.done;
    if (midIdx === index) color = COLORS.current;
    if (read.has(index)) color = COLORS.current;
    if (written.has(index)) color = COLORS.changed;
    const isHole = typeof e === 'object' && e !== null && 'hole' in e;
    return {
      key: ids?.[index] !== undefined ? `id${ids[index]}` : `ix${index}`,
      index,
      x: xOf(index, maxLen),
      label: isHole ? '' : cellText(tl, snap, e),
      num: bars ? num(e) : null,
      color,
      pulse: written.has(index),
    };
  });

  const pointers: PointerModel[] = [];
  const perIndex = new Map<number, number>();
  for (const p of b.pointers) {
    const value = ptrValue(p.ref);
    const index = value === null ? null : value + (p.offset ?? 0);
    if (index === null || index < -1 || index > maxLen) continue;
    const stack = perIndex.get(index) ?? 0;
    perIndex.set(index, stack + 1);
    pointers.push({ name: p.ref.name, role: p.role, index, x: xOf(index, maxLen), color: ROLE_COLOR[p.role], stack });
  }

  let delta: ArrayModel['delta'] = null;
  const w = [...written.entries()][0];
  if (w && w[1].old !== undefined) {
    const fmt = (x: V | undefined) => previewValue(tl, snap, x, { depth: 0, maxString: 8 });
    delta = { index: w[0], text: hl?.reversed ? `${fmt(w[1].value)} → ${fmt(w[1].old)}` : `${fmt(w[1].old)} → ${fmt(w[1].value)}` };
  }
  let pair: ArrayModel['pair'] = null;
  const writes = [...written.entries()];
  const same = (x: V | undefined, y: V | undefined) => JSON.stringify(x) === JSON.stringify(y);
  if (writes.length === 2 && same(writes[0][1].old, writes[1][1].value) && same(writes[1][1].old, writes[0][1].value)) {
    pair = { a: Math.min(writes[0][0], writes[1][0]), b: Math.max(writes[0][0], writes[1][0]), kind: 'swap' };
  } else if (!writes.length && read.size === 2) {
    const [a, b] = [...read].sort((x, y) => x - y);
    pair = { a, b, kind: 'compare' };
  }
  const focusIndex = w ? w[0] : read.size ? [...read][0] : pointers.find((p) => p.role === 'right' || p.role === 'mid')?.index ?? null;
  return {
    exists: v !== undefined, length: els.length, maxLen, bars, maxAbs: scale.maxAbs, elems, pointers, window, interval, delta, pair, focusIndex,
  };
}

/** Sorting: an index is final once its last write has happened (and the array ends sorted). */
function isSettled(tl: Timeline, scale: Scale, index: number, i: number): boolean {
  if (!scale.sortedAtEnd || tl.status !== 'ok') return false;
  if (i === tl.steps.length - 1) return true;
  const last = scale.lastWrite.get(index);
  return last !== undefined && last < i;
}
