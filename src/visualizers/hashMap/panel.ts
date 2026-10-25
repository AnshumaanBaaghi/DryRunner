/**
 * Hash-map panel geometry: the title, entry cards in a grid of 2–4 columns (insertion order, row by
 * row), a "+N more" note when the map outgrows the grid, and the size line under it with room for a
 * "miss" chip at its right end. Local units: x centered on 0, y up from the panel's bottom. Sizes only
 * depend on trace-wide maxima, so the panel never jumps.
 */
import type { HashKind } from './detect';
import { CARD_CAP, type HashExtent } from './model';

export const CARD = { h: 0.56, d: 0.28, gap: 0.22, pitch: 0.74, text: 0.22 };
export const TITLE_SIZE = 0.3;
export const STATS_SIZE = 0.24;
export const NOTE_SIZE = 0.2;
export const CHIP_SIZE = 0.2;
export const CHIP_H = 0.36;
export const STATS_Y = 0.28;
/** the size line sits in this band under the cards */
const STATS_H = 0.66;
/** a "+N more" line under the title when the map outgrows the cards */
const NOTE_H = 0.38;
const MIN_CARD_W: Record<HashKind, number> = { map: 1.5, set: 0.8, object: 1.5 };
const MAX_CARD_W = 3.4;
/** no more columns than fit this width */
const MAX_GRID_W = 9;
const CHIP_GAP = 0.35;

export const textWidth = (s: string, size: number) => [...s].length * size * 0.6;

export const titleText = (name: string, kind: HashKind) => `${name} · ${kind === 'map' ? 'Map' : kind === 'set' ? 'Set' : 'object'}`;

export const chipWidth = (text: string) => textWidth(text, CHIP_SIZE) + 0.3;

/** Label size keeping a card's text on its face. */
export const fitText = (text: string, cardW: number) => Math.min(CARD.text, (cardW - 0.24) / (0.6 * Math.max(1, [...text].length)));

export interface HashLayout {
  rows: number;
  cols: number;
  cardW: number;
  /** left edge */
  x0: number;
  titleY: number;
  noteY: number;
  w: number;
  h: number;
}

export function hashLayout(extent: HashExtent, kind: HashKind, title: string): HashLayout {
  const n = Math.max(1, Math.min(extent.maxEntries, CARD_CAP));
  const cardW = Math.min(MAX_CARD_W, Math.max(MIN_CARD_W[kind], textWidth('x'.repeat(extent.widest), CARD.text) + 0.36));
  const fit = Math.floor((MAX_GRID_W + CARD.gap) / (cardW + CARD.gap));
  const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(n)), fit));
  const rows = Math.ceil(n / cols);
  const cardsTop = STATS_H + rows * CARD.pitch;
  const titleY = cardsTop + (extent.maxEntries > CARD_CAP ? NOTE_H : 0) + 0.4;
  // the size line leaves room for the widest miss chip of the run at its right end
  const chip = extent.widestMiss ? CHIP_GAP + chipWidth('x'.repeat(extent.widestMiss)) : 0;
  const w = Math.max(cols * cardW + (cols - 1) * CARD.gap, textWidth(title, TITLE_SIZE), textWidth(`size ${extent.maxEntries}`, STATS_SIZE) + chip);
  return { rows, cols, cardW, x0: -w / 2, titleY, noteY: cardsTop + 0.2, w, h: titleY + 0.32 };
}

/** Center of card slot k (row by row, top to bottom). */
export function slotCenter(g: HashLayout, k: number): [number, number] {
  const row = Math.floor(k / g.cols);
  const col = k % g.cols;
  return [g.x0 + col * (g.cardW + CARD.gap) + g.cardW / 2, STATS_H + (g.rows - row - 0.5) * CARD.pitch];
}

/** Center of the miss chip: on the size line, at the panel's right edge. */
export const chipCenter = (g: HashLayout, text: string): [number, number] => [g.x0 + g.w - chipWidth(text) / 2, STATS_Y];
