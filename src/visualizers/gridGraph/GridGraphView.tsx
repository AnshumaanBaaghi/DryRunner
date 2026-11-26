/**
 * A grid graph on a Grid2D: water deep blue, unvisited land green-brown, visited cells tinted by component and
 * raised (a backtracking DFS: while on its path, then a faint trail), walls dark; the current cell amber with a
 * pulsing rim, cells marked or put back this step orange, probed cells violet rims and the cells waiting (DFS
 * path / BFS frontier) blue rims. Title and counter above the board; the composition (headers included) is
 * centered on x = 0 and keeps one size through the trace. A backtracking DFS shares the stage with its
 * recursion tree: the camera keeps to the grid's current cell.
 */
import { useCallback, useMemo } from 'react';
import { useAnimTiming, useHighlight } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { cellPosition, gridSize, type GridGeometry } from '../../scene/primitives/grid';
import { Grid2D, type GridMark } from '../../scene/primitives/Grid2D';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { EMPTY } from '../dp1d/table';
import type { VizProps } from '../types';
import type { Cell } from './cells';
import type { GridGraphBindings } from './detect';
import { buildGridModel, CELL, GAP } from './model';

type Vec3 = [number, number, number];

const SEP = '\n';
const PITCH = CELL + GAP;
/** room left of the board for the row numbers, above it for the column numbers, the counter and the title */
const HEADER_W = PITCH * 1.2;
const COL_HEADER_H = PITCH * 1.05;
const COUNTER_H = 0.5;
const TITLE_H = 0.55;
const TITLE_SIZE = 0.32;
const COUNTER_SIZE = 0.3;
/** beyond this many rows / columns the index headers are left out */
const HEADER_LIMIT = 40;

const textWidth = (s: string, size: number) => [...s].length * size * 0.6;
const indexes = (n: number) => Array.from({ length: n }, (_, k) => String(k));

export function GridGraphView({ view, detection }: VizProps<GridGraphBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const m = useMemo(() => buildGridModel(view.tl, view.i, b, hl), [view, b, hl]);
  const { rows, cols } = m;
  const geo = useMemo<GridGeometry>(() => ({ rows, cols, cell: CELL, gap: GAP }), [rows, cols]);
  const { w, h } = gridSize(geo);
  const title = `${detection.title} · grid`;
  const counterW = b.counter ? textWidth(`${b.counter.name}: 0000`, COUNTER_SIZE) : 0;
  const width = Math.max(HEADER_W + w, textWidth(title, TITLE_SIZE), counterW);
  const counterH = b.counter ? COUNTER_H : 0;
  const height = h + COL_HEADER_H + counterH + TITLE_H;
  const gridX = -width / 2 + HEADER_W + w / 2;
  const stepKey = hl?.key ?? String(view.i);
  useReportSize({ w: width + 0.6, h: height, d: 1.4 });

  // keyed by content: Grid2D re-targets its tiles only when a color or a raise actually changes
  const colorKey = m.color.join(SEP);
  const labelKey = m.text.join(SEP);
  const inkKey = m.ink.join(SEP);
  const raiseKey = m.raise.join(SEP);
  const colors = useMemo(() => colorKey.split(SEP), [colorKey]);
  const labels = useMemo(() => labelKey.split(SEP), [labelKey]);
  const inks = useMemo(() => inkKey.split(SEP), [inkKey]);
  const raises = useMemo(() => raiseKey.split(SEP).map(Number), [raiseKey]);
  const colorOf = useCallback((r: number, c: number) => colors[r * cols + c] ?? EMPTY, [colors, cols]);
  const labelOf = useCallback((r: number, c: number) => labels[r * cols + c] ?? '', [labels, cols]);
  const labelColorOf = useCallback((r: number, c: number) => inks[r * cols + c] ?? COLORS.ink, [inks, cols]);
  const raiseOf = useCallback((r: number, c: number) => raises[r * cols + c] ?? 0, [raises, cols]);
  const headers = rows <= HEADER_LIMIT && cols <= HEADER_LIMIT;
  const rowHeaders = useMemo(() => (headers ? indexes(rows) : undefined), [headers, rows]);
  const colHeaders = useMemo(() => (headers ? indexes(cols) : undefined), [headers, cols]);

  const { current, marked, unmarked, probes, waiting } = m;
  const marks = useMemo(() => {
    // one rim per cell, the most telling first: current, marked or put back now, probed, waiting
    const out: GridMark[] = [];
    const seen = new Set<string>();
    const add = (cell: Cell, color: string, pulseKey?: string) => {
      const key = `${cell.r}:${cell.c}`;
      if (seen.has(key) || cell.r < 0 || cell.c < 0 || cell.r >= rows || cell.c >= cols) return;
      seen.add(key);
      out.push({ r: cell.r, c: cell.c, color, ...(pulseKey && { pulseKey }) });
    };
    if (current?.inside) add(current, COLORS.current, current.key);
    for (const cell of [...marked, ...unmarked]) add(cell, COLORS.changed, stepKey);
    for (const p of probes) if (p.inside) add(p, COLORS.frontier);
    for (const cell of waiting) add(cell, COLORS.visited);
    return out;
  }, [current, marked, unmarked, probes, waiting, rows, cols, stepKey]);

  const at = (r: number, c: number): Vec3 => {
    const [x, y] = cellPosition(geo, r, c);
    return [gridX + x, y, 0];
  };
  useFocusPoint(detection.key, m.exists && m.focus ? at(m.focus.r, m.focus.c) : null, b.backtrack ? 3 : 2, stepKey);
  return (
    <group>
      <Label text={title} position={[-width / 2, height - 0.25, 0]} anchorX="left" size={TITLE_SIZE} color={COLORS.inkDim} />
      {m.counter && (
        <Label text={`${m.counter.name}: ${m.counter.text}`} position={[-width / 2, h + COL_HEADER_H + counterH * 0.45, 0]} anchorX="left"
          size={COUNTER_SIZE} color={COLORS.ink} />
      )}
      {m.exists ? (
        <group position={[gridX, 0, 0]}>
          <Grid2D rows={rows} cols={cols} cell={CELL} gap={GAP} colorOf={colorOf} labelOf={labelOf} labelColorOf={labelColorOf}
            raiseOf={raiseOf} marks={marks} rowHeaders={rowHeaders} colHeaders={colHeaders} timing={timing} />
        </group>
      ) : (
        <Label text="(not created yet)" position={[0, h / 2, 0]} size={0.28} color={COLORS.inkFaint} />
      )}
    </group>
  );
}
