/**
 * Side-panel geometry of the backtracking view, stacked bottom → top: the solutions count, a secondary
 * flags row, the main structure (path row, board or flags row). Local units: x from the panel's left
 * edge, y up from its bottom. Sizes only depend on trace-wide maxima, so the panel never jumps.
 */
import { gridSize } from '../../scene/primitives/grid';
import type { BacktrackMode } from './detect';
import { textWidth, type PanelModel, type RowModel } from './model';

export const PANEL_GAP = 1.5;
export const TITLE_SIZE = 0.28;

export interface SlotGeometry {
  size: number;
  pitch: number;
}

export const PATH_SLOT: SlotGeometry = { size: 0.8, pitch: 0.96 };
export const FLAG_SLOT: SlotGeometry = { size: 0.56, pitch: 0.68 };
export const BOARD_CELL = { cell: 0.9, gap: 0.08 };
/** room left of the board for its row numbers */
export const BOARD_INSET = 0.6;
/** a row's blocks rest on this height (its index numbers sit below) */
export const ROW_BASE = 0.36;
/** how far a pushed block drops in from (and a popped one lifts out to) */
export const DROP = 0.9;

const SPACING = 0.5;
const RESULTS_H = 1.0;

export const rowTitleY = (slot: SlotGeometry) => ROW_BASE + slot.size + 0.36;
export const boardSize = (rows: number, cols: number) => gridSize({ rows, cols, ...BOARD_CELL });

export interface PanelPart {
  kind: 'path' | 'flags' | 'board' | 'results';
  /** bottom of the part */
  y: number;
  h: number;
  w: number;
  /** block geometry of a row part */
  slot?: SlotGeometry;
}

export interface PanelLayout {
  parts: PanelPart[];
  w: number;
  h: number;
}

function rowPart(kind: 'path' | 'flags', row: RowModel, slot: SlotGeometry): Omit<PanelPart, 'y'> {
  return { kind, slot, h: rowTitleY(slot) + 0.2, w: Math.max(row.capacity * slot.pitch, textWidth(row.name, TITLE_SIZE)) };
}

export function panelLayout(m: PanelModel, mode: BacktrackMode): PanelLayout {
  const stack: Omit<PanelPart, 'y'>[] = [];
  if (m.results) {
    const w = Math.max(textWidth('solutions: 000', 0.3), textWidth(`last: ${'x'.repeat(m.results.widest)}`, 0.2));
    stack.push({ kind: 'results', h: RESULTS_H, w });
  }
  if (m.flags && mode !== 'flags') stack.push(rowPart('flags', m.flags, FLAG_SLOT));
  if (mode === 'board' && m.board) {
    const { w, h } = boardSize(m.board.rows, m.board.cols);
    stack.push({ kind: 'board', h: h + 1.1, w: BOARD_INSET + w });
  } else if (mode === 'path' && m.path) stack.push(rowPart('path', m.path, PATH_SLOT));
  else if (mode === 'flags' && m.flags) stack.push(rowPart('flags', m.flags, PATH_SLOT));
  const parts: PanelPart[] = [];
  let y = 0;
  for (const p of stack) {
    parts.push({ ...p, y });
    y += p.h + SPACING;
  }
  return { parts, w: Math.max(0, ...stack.map((p) => p.w)), h: Math.max(0, y - SPACING) };
}
