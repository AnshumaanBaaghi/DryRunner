/**
 * Cache panel geometry: the title, entry cards in columns (insertion order, top to bottom) and the
 * counts under them. Local units: x from the panel's left edge, y up from its bottom. Sizes only depend
 * on trace-wide maxima, so the panel never jumps.
 */
import { CARD_CAP, textWidth, type CacheExtent } from './model';

export const CARD = { h: 0.6, d: 0.3, pitch: 0.76, gap: 0.3, text: 0.22 };
export const TITLE_SIZE = 0.28;
export const STATS_SIZE = 0.24;
export const NOTE_SIZE = 0.2;
export const STATS_Y = 0.3;
const CARD_ROWS = 8;
/** the counts line sits in this band under the cards */
const STATS_H = 0.7;
/** a "+N earlier" line under the title when the cache outgrows the cards */
const NOTE_H = 0.4;
const MIN_CARD_W = 1.6;

export interface CacheLayout {
  rows: number;
  cols: number;
  cardW: number;
  titleY: number;
  noteY: number;
  w: number;
  h: number;
}

export function cacheLayout(extent: CacheExtent, name: string): CacheLayout {
  const n = Math.max(1, Math.min(extent.maxEntries, CARD_CAP));
  const rows = Math.min(n, CARD_ROWS);
  const cols = Math.ceil(n / rows);
  const cardW = Math.max(MIN_CARD_W, textWidth('x'.repeat(extent.widest), CARD.text) + 0.36);
  const cardsTop = STATS_H + rows * CARD.pitch;
  const titleY = cardsTop + (extent.maxEntries > CARD_CAP ? NOTE_H : 0) + 0.4;
  const w = Math.max(
    cols * cardW + (cols - 1) * CARD.gap,
    textWidth(`${name} (cache)`, TITLE_SIZE),
    textWidth(`hits: ${extent.hits} · entries: ${extent.maxEntries}`, STATS_SIZE),
  );
  return { rows, cols, cardW, titleY, noteY: cardsTop + 0.22, w, h: titleY + 0.3 };
}

/** Center of card slot k (column by column, top to bottom). */
export function slotCenter(g: CacheLayout, k: number): [number, number] {
  const col = Math.floor(k / g.rows);
  const row = k % g.rows;
  return [col * (g.cardW + CARD.gap) + g.cardW / 2, STATS_H + (g.rows - row - 0.5) * CARD.pitch];
}
