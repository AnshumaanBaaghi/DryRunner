/**
 * Pure per-step model of the 1D DP view (testable without WebGL): each cell's value and state (cells read
 * but never written are base values, filled from the start), the dependencies of this step's write (read
 * cells → written cell), its old → new delta and the index pointer.
 * Layout constants: blocks rest on y = 0, arcs above them, then the pointer, the delta and the title.
 */
import type { Timeline } from '../../engine/timeline/types';
import type { ObjId, V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import { writeSteps1d, type Dp1dBindings } from './detect';
import {
  cached, cellText, deltaText, EMPTY, fillTimes, isFilled, mixHex, readCells, scopedValues, stateOf, writtenCell, type Cache, type CellState,
  type FillTimes,
} from './table';

export const SPACING = 1.08;
export const BLOCK = 0.9;
export const BLOCK_Y = 0.48;
export const INDEX_Y = -0.32;
/** dependency arcs start just above the blocks and peak at most ARC_PEAK higher */
export const ARROW_Y = 1.0;
const ARC_PEAK = 0.56;
export const POINTER_Y = 1.75;
export const DELTA_Y = 2.85;
export const TITLE_Y = 3.5;
export const HEIGHT = 3.8;

/** computed cells: a blue tint between the empty blocks and COLORS.visited */
export const FILLED = mixHex(EMPTY, COLORS.visited, 0.55);
const COLOR: Record<CellState, string> = { empty: EMPTY, filled: FILLED, written: COLORS.changed, read: COLORS.current };

export const xOf = (index: number, maxLen: number) => (index - (maxLen - 1) / 2) * SPACING;

/** Arc bend for a dependency spanning `dist`: Arrow peaks at dist · bend · 0.175, kept under ARC_PEAK. */
export const arcBend = (dist: number) => Math.min(0.8, ARC_PEAK / 0.175 / Math.max(dist, 1e-3));

export interface Dp1dCell {
  index: number;
  x: number;
  text: string;
  state: CellState;
  color: string;
}

export interface Dp1dModel {
  exists: boolean;
  /** longest the table gets in the trace (stable width) */
  maxLen: number;
  cells: Dp1dCell[];
  written: number | null;
  /** cells read by this step's write → the written cell */
  deps: { from: number; to: number }[];
  delta: { index: number; text: string } | null;
  pointer: { name: string; index: number; x: number } | null;
  focusIndex: number | null;
}

interface Shape {
  maxLen: number;
  times: FillTimes;
}

const shapeCache: Cache<Shape> = new WeakMap();

function shapeOf(tl: Timeline, objId: ObjId): Shape {
  return cached(shapeCache, tl, String(objId), () => {
    let maxLen = 0;
    let last: unknown;
    for (const snap of tl.snapshots) {
      const obj = snap.heap.get(objId);
      if (!obj || obj === last) continue;
      last = obj;
      maxLen = Math.max(maxLen, obj.elems?.size ?? 0);
    }
    return { maxLen, times: fillTimes(writeSteps1d(tl, objId)) };
  });
}

export function buildDp1dModel(tl: Timeline, i: number, b: Dp1dBindings, hl: Highlight | null): Dp1dModel {
  const snap = tl.snapshots[i];
  const { maxLen, times } = shapeOf(tl, b.objId);
  const elems = snap.heap.get(b.objId)?.elems;
  const rows = new Map([[b.objId, 0]]);
  // a cell set twice in one step: its first old value, its last new one
  const writes = new Map<number, { r: number; c: number; old?: V; value?: V }>();
  for (const h of hl?.diff.heap ?? []) {
    const cell = writtenCell(h, rows);
    if (!cell) continue;
    const prev = writes.get(cell.c);
    writes.set(cell.c, { ...cell, old: prev ? prev.old : h.old, value: h.value });
  }
  const written = [...writes.values()];
  const read = new Set((hl ? readCells(hl.diff.reads, rows, written) : []).map((q) => q.c));
  const cells = elems === undefined ? [] : Array.from({ length: maxLen }, (_, index): Dp1dCell => {
    const state = stateOf(writes.has(index), read.has(index), index < elems.size && isFilled(times, `0:${index}`, i));
    return { index, x: xOf(index, maxLen), text: cellText(tl, snap, elems.get(index)), state, color: COLOR[state] };
  });
  const target = written[0];
  const v = b.index ? scopedValues(tl, b.index)[i] : undefined;
  const pointer = b.index && typeof v === 'number' && v >= -1 && v <= maxLen ? { name: b.index.name, index: v, x: xOf(v, maxLen) } : null;
  const inside = pointer && pointer.index >= 0 && pointer.index < maxLen ? pointer.index : null;
  return {
    exists: elems !== undefined,
    maxLen,
    cells,
    written: target ? target.c : null,
    deps: target ? [...read].map((from) => ({ from, to: target.c })) : [],
    delta: target && hl ? { index: target.c, text: deltaText(tl, snap, target, hl.reversed) } : null,
    pointer,
    focusIndex: target?.c ?? [...read][0] ?? inside,
  };
}
