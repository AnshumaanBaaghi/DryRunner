/** Geometry of Grid2D boards (row 0 on top, x centered on 0, bottom row resting on y = 0). */
export const LABEL_LIMIT = 300;

export interface GridGeometry {
  rows: number;
  cols: number;
  /** tile size */
  cell?: number;
  gap?: number;
}

const pitchOf = (g: GridGeometry) => (g.cell ?? 0.9) + (g.gap ?? 0.08);

/** Center of cell (r, c). */
export function cellPosition(g: GridGeometry, r: number, c: number): [number, number, number] {
  const pitch = pitchOf(g);
  return [(c - (g.cols - 1) / 2) * pitch, (g.rows - 1 - r) * pitch + pitch / 2, 0];
}

export function gridSize(g: GridGeometry): { w: number; h: number } {
  const pitch = pitchOf(g);
  return { w: g.cols * pitch, h: g.rows * pitch };
}
