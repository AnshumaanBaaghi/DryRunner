/**
 * Pure per-step model of the 2D DP view (testable without WebGL). Per cell (row-major): value text, state,
 * tile color — dark until computed, then a heat scale from dark blue to cyan over the values the table
 * takes in the whole trace (stable colors) — and label color. Base values count as computed from the
 * start: the border the fill never writes (LCS's row 0 and column 0) and cells read but never written.
 * Plus this step's write, the cells it read, its delta, the cell filled last (current row / column), headers.
 */
import type { Timeline } from '../../engine/timeline/types';
import { deref, primitive } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import {
  cached, cellKey, cellText, deltaText, EMPTY, fillTimes, glyphSafe, isFilled, mixHex, readCells, rowsAt, stateOf, writtenCell, type Cache,
  type Cell, type CellState, type FillTimes,
} from '../dp1d/table';
import { stringAt, tableShape, writeSteps2d, type Dp2dBindings, type HeaderBinding } from './detect';

export const CELL = 0.9;
export const GAP = 0.08;
export const HEAT_LO = '#1d3a66';
/** computed cells holding something other than a finite number or a boolean (∞, strings) */
export const OTHER = '#3b4f78';
/** heat above which a label turns dark */
const LIGHT = 0.6;

export const heatColor = (t: number) => mixHex(HEAT_LO, COLORS.window, t);

export interface Dp2dModel {
  exists: boolean;
  /** largest size in the trace (a stable board) */
  rows: number;
  cols: number;
  /** row-major, rows × cols */
  text: string[];
  state: CellState[];
  color: string[];
  ink: string[];
  written: Cell | null;
  /** cells read by this step's write */
  deps: Cell[];
  delta: (Cell & { text: string }) | null;
  /** the cell written last, up to this step */
  current: Cell | null;
  rowHeaders: string[];
  colHeaders: string[];
  focus: Cell | null;
}

interface Info {
  times: FillTimes;
  /** write steps in order and the first cell each wrote */
  steps: number[];
  cells: Cell[];
  /** heat range: every finite number written, and 0 */
  lo: number;
  hi: number;
}

const infoCache: Cache<Info> = new WeakMap();

function infoOf(tl: Timeline, outer: ObjId): Info {
  return cached(infoCache, tl, String(outer), () => {
    const writeSteps = writeSteps2d(tl, outer);
    const steps: number[] = [];
    const cells: Cell[] = [];
    let lo = 0;
    let hi = 0;
    for (const s of writeSteps) {
      steps.push(s.step);
      cells.push({ r: s.writes[0].r, c: s.writes[0].c });
      for (const w of s.writes) {
        const p = primitive(tl, w.value);
        if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue;
        lo = Math.min(lo, p.value);
        hi = Math.max(hi, p.value);
      }
    }
    return { times: fillTimes(writeSteps), steps, cells, lo, hi };
  });
}

/** Position on the heat scale (null: not a number or a boolean). */
function heatOf(tl: Timeline, v: V | undefined, info: Info): number | null {
  if (v === true) return 1;
  if (v === false) return 0;
  const p = primitive(tl, v);
  if (typeof p.value !== 'number' || !Number.isFinite(p.value)) return null;
  return info.hi > info.lo ? (p.value - info.lo) / (info.hi - info.lo) : 0;
}

/** Index of the last entry ≤ i of an ascending list (-1 if none). */
function lastAtOrBefore(steps: readonly number[], i: number): number {
  let lo = 0;
  let hi = steps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid] <= i) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The header string's characters (after an empty header for the offset -1 prefix row), else indexes. */
export function headersOf(tl: Timeline, h: HeaderBinding | undefined, n: number, i: number): string[] {
  const text = h ? stringAt(tl, h.ref, i) : null;
  const chars = text === null ? [] : [...text].map(glyphSafe);
  if (!h || chars.length !== n + h.offset) return Array.from({ length: n }, (_, k) => String(k));
  return h.offset === -1 ? ['', ...chars] : chars;
}

export function buildDp2dModel(tl: Timeline, i: number, b: Dp2dBindings, hl: Highlight | null): Dp2dModel {
  const snap = tl.snapshots[i];
  const { rows, cols } = tableShape(tl, b.objId);
  const info = infoOf(tl, b.objId);
  const outer = snap.heap.get(b.objId)?.elems;
  // stepping back, the highlighted changes are the undone step's: map its rows as of that step
  const rowMap = rowsAt(tl, b.objId, Math.min(hl?.reversed ? i + 1 : i, tl.steps.length - 1));
  const writes = new Map<string, Cell & { old?: V; value?: V }>();
  for (const h of hl?.diff.heap ?? []) {
    const cell = writtenCell(h, rowMap);
    if (!cell) continue;
    const prev = writes.get(cellKey(cell));
    writes.set(cellKey(cell), { ...cell, old: prev ? prev.old : h.old, value: h.value });
  }
  const written = [...writes.values()];
  const deps = hl ? readCells(hl.diff.reads, rowMap, written) : [];
  const read = new Set(deps.map(cellKey));
  const text: string[] = [];
  const state: CellState[] = [];
  const color: string[] = [];
  const ink: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = deref(snap, outer?.get(r))?.elems;
    for (let c = 0; c < cols; c++) {
      const key = `${r}:${c}`;
      const v = row?.get(c);
      // rows / columns the fill never writes (LCS's row 0 and column 0) are the base border
      const border = !info.times.rows.has(r) || !info.times.cols.has(c);
      const filled = v !== undefined && (border || isFilled(info.times, key, i));
      const t = filled ? heatOf(tl, v, info) : null;
      text.push(cellText(tl, snap, v));
      state.push(stateOf(writes.has(key), read.has(key), filled));
      color.push(!filled ? EMPTY : t === null ? OTHER : heatColor(t));
      ink.push(t !== null && t > LIGHT ? COLORS.bg : COLORS.ink);
    }
  }
  const target = written[0];
  const last = lastAtOrBefore(info.steps, i);
  const current = last >= 0 ? info.cells[last] : null;
  return {
    exists: outer !== undefined,
    rows,
    cols,
    text,
    state,
    color,
    ink,
    written: target ? { r: target.r, c: target.c } : null,
    deps,
    delta: target && hl ? { r: target.r, c: target.c, text: deltaText(tl, snap, target, hl.reversed) } : null,
    current,
    rowHeaders: headersOf(tl, b.rowHeader, rows, i),
    colHeaders: headersOf(tl, b.colHeader, cols, i),
    focus: target ? { r: target.r, c: target.c } : deps[0] ?? current,
  };
}
