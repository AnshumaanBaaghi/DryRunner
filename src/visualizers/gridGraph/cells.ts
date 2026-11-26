/**
 * Grid cells as a traversal sees them: the cells of a 2D array read in a step (a row array maps to its row
 * through the outer array's elements at that step), the cell an `[r, c]` pair or a visited-Set key
 * (`'r,c'`, `r * cols + c`) stands for, and how a cell's value reads on the map. Pure.
 */
import { keyRepr } from '../../engine/timeline/heap';
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { primitive, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import { readCells, rowsAt, type Cell } from '../dp1d/table';

export type { Cell };

export interface GridCell extends Cell {
  /** within the grid (out-of-bounds probes are kept, but drawn as nothing) */
  inside: boolean;
}

export interface Shape {
  rows: number;
  cols: number;
}

/** water: the background a traversal never enters · wall: a blocked cell · land: ground the traversal walks */
export type CellKind = 'land' | 'water' | 'wall' | 'other';

export const isInside = (s: Shape, r: number, c: number) => r >= 0 && c >= 0 && r < s.rows && c < s.cols;
export const gridCell = (s: Shape, cell: Cell): GridCell => ({ r: cell.r, c: cell.c, inside: isInside(s, cell.r, cell.c) });

/** One step apart: ±1 in exactly one coordinate. */
export const adjacent = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

export function intOf(tl: Timeline, v: V | undefined): number | null {
  const p = primitive(tl, v);
  return typeof p.value === 'number' && Number.isInteger(p.value) ? p.value : null;
}

/** The cell an `[r, c]` (or `[r, c, …]`) array value stands for; `order` holds the positions of r and c. */
export function pairCell(tl: Timeline, snap: Snapshot, v: V | undefined, order: readonly [number, number] = [0, 1]): Cell | null {
  const id = refId(v);
  const elems = id === null ? undefined : snap.heap.get(id)?.elems;
  if (!elems || elems.size < 2) return null;
  const r = intOf(tl, elems.get(order[0]));
  const c = intOf(tl, elems.get(order[1]));
  return r === null || c === null ? null : { r, c };
}

/** The cell a visited-Set key stands for: `'r,c'` (any separator) or `r * cols + c`. */
export function keyCell(tl: Timeline, key: V | undefined, cols: number): Cell | null {
  const p = primitive(tl, key);
  if (typeof p.value === 'number') {
    return Number.isInteger(p.value) && p.value >= 0 && cols > 0 ? { r: Math.floor(p.value / cols), c: p.value % cols } : null;
  }
  const m = typeof p.value === 'string' ? /^\D*?(-?\d+)\D+?(-?\d+)\D*$/.exec(p.value) : null;
  return m ? { r: Number(m[1]), c: Number(m[2]) } : null;
}

/** Distinct cells of the 2D array `outer` read in step s (`grid[r][c]`), in reading order. */
export function cellsRead(tl: Timeline, outer: ObjId, s: number): Cell[] {
  const reads = tl.diffs[s]?.reads;
  return reads?.length ? readCells(reads, rowsAt(tl, outer, s), []) : [];
}

/** Cells of a visited Set looked up (`seen.has(key)`) in step s. */
export function keysRead(tl: Timeline, set: ObjId, s: number, cols: number): Cell[] {
  const out: Cell[] = [];
  for (const e of tl.diffs[s]?.reads ?? []) {
    const cell = e.id === set && e.op === 'has' ? keyCell(tl, e.key, cols) : null;
    if (cell) out.push(cell);
  }
  return out;
}

const WATER = new Set(['s:0', 'n:0', 's:.', 'b:false', 's:~']);
const LAND = new Set(['s:1', 'n:1', 'b:true']);
const WALL = new Set(['s:#', 's:X', 's:x']);

/**
 * How a value reads: `open` holds the values cells had when the traversal marked them (the ground it walks:
 * '1' on an islands map, '.' in a maze). Without marks, '1' / 1 / true count as land.
 */
export function kindOf(v: V | undefined, open: ReadonlySet<string>): CellKind {
  const k = keyRepr(v);
  if (open.has(k)) return 'land';
  if (WATER.has(k)) return 'water';
  if (WALL.has(k)) return 'wall';
  // land-like values the traversal never walks are its obstacles (1 = wall in a 0 / 1 maze)
  if (LAND.has(k)) return open.size ? 'wall' : 'land';
  return 'other';
}

/** A marking write that turns the cell into water (`'1' → '0'`) sinks it; any other value fills it. */
export const isWaterValue = (v: V | undefined) => WATER.has(keyRepr(v));

/**
 * The ground a traversal walks (`keyRepr`): the values cells had when it marked them, first mark first. A search
 * crossing obstacles (a budget of eliminations) marks both kinds of cell on a 0 / 1 map: the kind it started on
 * is the ground, so the other kind keeps reading as obstacles.
 */
export function groundOf(was: readonly (V | undefined)[], crossing: boolean): Set<string> {
  const open = new Set(was.map((v) => keyRepr(v)));
  if (!crossing || !was.length || ![...open].every((k) => WATER.has(k) || LAND.has(k))) return open;
  const water = WATER.has(keyRepr(was[0]));
  return new Set([...open].filter((k) => WATER.has(k) === water));
}
