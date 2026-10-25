/**
 * Shared by the DP table plugins (dp1d, dp2d). A table is filled by `set` writes at numeric indexes;
 * each write step's dependencies are the other cells of the table read in that step. A DP fill visits
 * cells in loop order (row- or column-major, either direction), writes a cell at most twice and only
 * ever reads cells filled earlier — a relaxation (Dijkstra's `dist`) also reads cells it reaches later.
 * Plus compact cell text, colors and the variables a table is named / indexed by. Pure.
 */
import type { List } from 'immutable';
import { resolveVarKey, type TraceAnalysis, type ValueKind, type VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import { visibleVars } from '../../engine/timeline/scope';
import type { ReadEvent } from '../../engine/types/trace';
import type { FrameSnap, HeapChange, Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, primitive, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import { LABEL_GLYPHS } from '../../scene/glyphs';

export interface Cell {
  r: number;
  c: number;
}

export type CellState = 'empty' | 'filled' | 'written' | 'read';

export interface CellWrite extends Cell {
  step: number;
  old?: V;
  value?: V;
}

export interface WriteStep {
  step: number;
  writes: CellWrite[];
  /** other cells of the table read in the same step (the recurrence) */
  reads: Cell[];
}

/** tiles / blocks not computed yet */
export const EMPTY = '#161e2b';
/** share of consecutive first writes that must follow one loop order */
export const MIN_ORDER = 0.8;
export const MAX_WRITES = 2;

export type Cache<T> = WeakMap<Timeline, Map<string, { steps: number; value: T }>>;

/** Per-timeline memo, recomputed when the timeline grew. */
export function cached<T>(cache: Cache<T>, tl: Timeline, key: string, make: () => T): T {
  let byKey = cache.get(tl);
  if (!byKey) cache.set(tl, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.steps === tl.steps.length) return hit.value;
  const value = make();
  byKey.set(key, { steps: tl.steps.length, value });
  return value;
}

export const cellKey = (c: Cell) => `${c.r}:${c.c}`;

/** The element index a one-step path addresses (`arr[3]` → 3). */
const pathIndex = (path: (string | number)[]): number | null => (path.length === 1 && typeof path[0] === 'number' ? path[0] : null);

/** The cell a heap change writes (`set` at a numeric index of a mapped array), if any. */
export function writtenCell(h: HeapChange, rows: ReadonlyMap<ObjId, number>): Cell | null {
  const r = rows.get(h.id);
  const c = pathIndex(h.path);
  return h.op === 'set' && r !== undefined && c !== null ? { r, c } : null;
}

/** Distinct cells of the mapped arrays read in a step, minus the cells it writes. */
export function readCells(reads: readonly ReadEvent[], rows: ReadonlyMap<ObjId, number>, written: readonly Cell[]): Cell[] {
  const seen = new Set(written.map(cellKey));
  const out: Cell[] = [];
  for (const e of reads) {
    const r = rows.get(e.id);
    const c = pathIndex(e.path);
    if (r === undefined || c === null || seen.has(`${r}:${c}`)) continue;
    seen.add(`${r}:${c}`);
    out.push({ r, c });
  }
  return out;
}

/** Every step writing the table; `rowsOf(s)` maps the table's arrays to row indexes at step s (1D: `{ id → 0 }`). */
export function collectWriteSteps(tl: Timeline, rowsOf: (s: number) => ReadonlyMap<ObjId, number>): WriteStep[] {
  const out: WriteStep[] = [];
  for (let s = 0; s < tl.diffs.length; s++) {
    const d = tl.diffs[s];
    if (!d.heap.some((h) => h.op === 'set')) continue;
    const rows = rowsOf(s);
    if (!rows.size) continue;
    const writes: CellWrite[] = [];
    for (const h of d.heap) {
      const cell = writtenCell(h, rows);
      if (cell) writes.push({ ...cell, step: s, old: h.old, value: h.value });
    }
    if (writes.length) out.push({ step: s, writes, reads: readCells(d.reads, rows, writes) });
  }
  return out;
}

export interface FillStats {
  /** distinct cells written */
  cells: number;
  /** most writes one cell received */
  maxWrites: number;
  /** best share of consecutive first writes advancing in one loop order */
  order: number;
  /** write steps that read other cells of the table */
  depSteps: number;
  /** reads of cells the fill reaches only after the written one */
  forward: number;
}

/** Share of consecutive cells advancing in the best of the 8 loop orders (major axis × direction per axis). */
export function fillOrder(cells: readonly Cell[]): number {
  if (cells.length < 2) return 1;
  let best = 0;
  for (const rowMajor of [true, false]) {
    for (const s1 of [1, -1]) {
      for (const s2 of [1, -1]) {
        let ok = 0;
        for (let k = 1; k < cells.length; k++) {
          const a = cells[k - 1];
          const b = cells[k];
          const [a1, a2, b1, b2] = rowMajor ? [a.r * s1, a.c * s2, b.r * s1, b.c * s2] : [a.c * s1, a.r * s2, b.c * s1, b.r * s2];
          if (b1 > a1 || (b1 === a1 && b2 > a2)) ok += 1;
        }
        best = Math.max(best, ok / (cells.length - 1));
      }
    }
  }
  return best;
}

export function fillStats(steps: readonly WriteStep[]): FillStats {
  const count = new Map<string, number>();
  const rank = new Map<string, number>();
  const firsts: Cell[] = [];
  let maxWrites = 0;
  for (const s of steps) {
    for (const w of s.writes) {
      const k = cellKey(w);
      const n = (count.get(k) ?? 0) + 1;
      count.set(k, n);
      maxWrites = Math.max(maxWrites, n);
      if (!rank.has(k)) {
        rank.set(k, firsts.length);
        firsts.push(w);
      }
    }
  }
  let depSteps = 0;
  let forward = 0;
  for (const s of steps) {
    if (!s.reads.length) continue;
    depSteps += 1;
    const latest = Math.max(...s.writes.map((w) => rank.get(cellKey(w)) ?? 0));
    // cells never written are base values (row 0 of an LCS table): always available
    for (const q of s.reads) if ((rank.get(cellKey(q)) ?? -1) > latest) forward += 1;
  }
  return { cells: firsts.length, maxWrites, order: fillOrder(firsts), depSteps, forward };
}

export function isDpFill(s: FillStats, minCells: number): boolean {
  return s.cells >= minCells && s.maxWrites <= MAX_WRITES && s.order >= MIN_ORDER && s.depSteps > 0 && s.forward === 0;
}

export interface FillTimes {
  /** cell key → step of its first write */
  firstWrite: Map<string, number>;
  /** cells never written that writes read: initial values the recurrence builds on, filled from the start */
  base: Set<string>;
  /** rows / columns holding a written cell (in 2D, the cells outside them are the table's initial border) */
  rows: Set<number>;
  cols: Set<number>;
}

export function fillTimes(steps: readonly WriteStep[]): FillTimes {
  const firstWrite = new Map<string, number>();
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (const s of steps) {
    for (const w of s.writes) {
      if (!firstWrite.has(cellKey(w))) firstWrite.set(cellKey(w), s.step);
      rows.add(w.r);
      cols.add(w.c);
    }
  }
  const base = new Set<string>();
  for (const s of steps) for (const q of s.reads) if (!firstWrite.has(cellKey(q))) base.add(cellKey(q));
  return { firstWrite, base, rows, cols };
}

/** A cell holds a meaningful value at step i: computed by then, or a base value. */
export const isFilled = (t: FillTimes, key: string, i: number) => t.base.has(key) || (t.firstWrite.get(key) ?? Infinity) <= i;

// ── 2D tables: row arrays ──

const rowMaps = new WeakMap<List<V>, Map<ObjId, number>>();
const NO_ROWS: ReadonlyMap<ObjId, number> = new Map();

/** Row index of each array referenced by the elements of `outer` at step s. */
export function rowsAt(tl: Timeline, outer: ObjId, s: number): ReadonlyMap<ObjId, number> {
  const elems = tl.snapshots[s]?.heap.get(outer)?.elems;
  if (!elems) return NO_ROWS;
  let m = rowMaps.get(elems);
  if (!m) {
    m = new Map();
    for (let k = 0; k < elems.size; k++) {
      const id = refId(elems.get(k));
      if (id !== null && !m.has(id)) m.set(id, k);
    }
    rowMaps.set(elems, m);
  }
  return m;
}

// ── variables ──

const onlyKinds = (v: VarInfo, kind: ValueKind) => v.kinds.has(kind) && [...v.kinds].every((k) => k === kind || k === 'undefined' || k === 'null');
export const isIntVar = (v: VarInfo) => onlyKinds(v, 'int');
export const isStringVar = (v: VarInfo) => onlyKinds(v, 'string');

/** Function running a step. */
export const stepFn = (tl: Timeline, s: number) => tl.calls.get(tl.steps[s]?.callId ?? 0)?.fnId ?? 0;

/** Variables (not functions) that referenced the object. */
export function varsOf(a: TraceAnalysis, objId: ObjId): VarInfo[] {
  return [...(a.objects.get(objId)?.varKeys ?? [])].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
}

/** The variable that best names a table: only ever this object, in a function writing it, earliest. */
export function tableVar(a: TraceAnalysis, objId: ObjId, fnIds: ReadonlySet<number>): VarRef | undefined {
  const vars = varsOf(a, objId).sort((x, y) => Number(x.heapIds.size !== 1) - Number(y.heapIds.size !== 1)
    || Number(!fnIds.has(x.ref.fnId)) - Number(!fnIds.has(y.ref.fnId)) || x.firstStep - y.firstStep);
  return vars[0]?.ref;
}

/** Integer variables used as `T[idx]` / `T[idx ± k]` on a variable holding the object, in the given functions. */
export function indexVars(tl: Timeline, a: TraceAnalysis, objId: ObjId, fnIds: ReadonlySet<number>): VarInfo[] {
  const holders = new Set(varsOf(a, objId).map((v) => varKey(v.ref)));
  const out = new Map<string, VarInfo>();
  for (const u of tl.meta.analysis.indexUsage) {
    if (!fnIds.has(u.fnId) || !holders.has(resolveVarKey(a, u.object, u.fnId) ?? '')) continue;
    const key = resolveVarKey(a, u.index, u.fnId);
    const info = key ? a.vars.get(key) : undefined;
    if (info && isIntVar(info)) out.set(key as string, info);
  }
  return [...out.values()];
}

/** The binding of `ref` in scope in a frame; the latest declared one when several are. */
function inScope(tl: Timeline, f: FrameSnap, ref: VarRef): V | undefined {
  return visibleVars(tl, f).findLast((v) => ref.bids.includes(v.bid))?.slot.v;
}

/**
 * Value of a variable at step s (topmost frame of its function first, then closure frames), resolved through
 * scope visibility: with consecutive `for (let i …)` loops in one function the loop running now wins —
 * `valueAt` returns the first binding still held by the frame. Undefined while out of scope.
 */
export function scopedValueAt(tl: Timeline, ref: VarRef, s: number): V | undefined {
  const snap = tl.snapshots[s];
  if (!snap) return undefined;
  for (let k = snap.frames.size - 1; k >= 0; k--) {
    const f = snap.frames.get(k) as FrameSnap;
    const v = f.fnId === ref.fnId ? inScope(tl, f, ref) : undefined;
    if (v !== undefined) return v;
  }
  if (ref.fnId === 0) return undefined;
  for (const f of snap.detached.values()) {
    const v = f.fnId === ref.fnId ? inScope(tl, f, ref) : undefined;
    if (v !== undefined) return v;
  }
  return undefined;
}

const scopedCache: Cache<(V | undefined)[]> = new WeakMap();

/** `scopedValueAt` at every step, the last value carried forward once out of scope (like `trackVar`). */
export function scopedValues(tl: Timeline, ref: VarRef): (V | undefined)[] {
  return cached(scopedCache, tl, `${varKey(ref)}:${ref.bids.join(',')}`, () => {
    const out: (V | undefined)[] = [];
    let last: V | undefined;
    for (let s = 0; s < tl.steps.length; s++) {
      last = scopedValueAt(tl, ref, s) ?? last;
      out.push(last);
    }
    return out;
  });
}

/**
 * The variable whose value follows the written cells' `axis` coordinate (up to a constant offset, `dp[i + 1]`)
 * at the most write steps — at least half of them. Ties prefer the smaller offset, then list order.
 */
export function trackingVar(tl: Timeline, vars: readonly VarInfo[], steps: readonly WriteStep[], axis: 'r' | 'c'): VarRef | undefined {
  let best: { ref: VarRef; hits: number; offset: number } | undefined;
  for (const info of vars) {
    const offsets = new Map<number, number>();
    for (const s of steps) {
      const v = scopedValueAt(tl, info.ref, s.step);
      if (typeof v !== 'number') continue;
      const offset = s.writes[0][axis] - v;
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
    for (const [offset, hits] of offsets) {
      if (!best || hits > best.hits || (hits === best.hits && Math.abs(offset) < Math.abs(best.offset))) best = { ref: info.ref, hits, offset };
    }
  }
  return best && best.hits * 2 >= steps.length ? best.ref : undefined;
}

// ── text and colors ──

const GLYPHS = new Set(LABEL_GLYPHS);
/** Characters the label font lacks become '?'. */
export const glyphSafe = (s: string) => [...s].map((ch) => (GLYPHS.has(ch) ? ch : '?')).join('');

export function numText(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  if (Number.isInteger(n)) return Math.abs(n) < 1e6 ? String(n) : n.toExponential(1).replace('+', '');
  return String(Number(n.toPrecision(3)));
}

/** Value text that fits a cell: no quotes, ∞ for Infinity, ✓ / ✗ for booleans, '' for holes. */
export function cellText(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  if (v === true) return '✓';
  if (v === false) return '✗';
  const p = primitive(tl, v);
  if (p.ok && (p.value === undefined || p.value === null)) return v === null ? 'null' : '';
  if (p.ok && typeof p.value === 'number') return numText(p.value);
  if (p.ok && typeof p.value === 'string') return glyphSafe(p.value.length > 4 ? `${p.value.slice(0, 3)}…` : p.value);
  return glyphSafe(previewValue(tl, snap, v, { depth: 0, maxString: 3 }).slice(0, 6));
}

/** "old → new" (stepping back: "new → old"); '·' stands for nothing. */
export function deltaText(tl: Timeline, snap: Snapshot, w: Pick<CellWrite, 'old' | 'value'>, reversed: boolean): string {
  const f = (v: V | undefined) => cellText(tl, snap, v) || '·';
  return reversed ? `${f(w.value)} → ${f(w.old)}` : `${f(w.old)} → ${f(w.value)}`;
}

export function stateOf(written: boolean, read: boolean, filled: boolean): CellState {
  return written ? 'written' : read ? 'read' : filled ? 'filled' : 'empty';
}

const channels = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

/** Linear blend of two '#rrggbb' colors (t clamped to [0, 1]). */
export function mixHex(a: string, b: string, t: number): string {
  const u = Math.min(1, Math.max(0, t));
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((x, k) => Math.round(x + (cb[k] - x) * u).toString(16).padStart(2, '0')).join('')}`;
}
