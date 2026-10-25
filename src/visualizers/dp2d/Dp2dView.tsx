/**
 * A 2D DP table on a Grid2D: computed cells tinted by value (dark blue → cyan), cells not computed yet dark,
 * this step's write pulsing orange with glowing arrows from the cells it read (amber rims), "old → new"
 * up-right of it (clear of the cells a row-major fill reads), and the row / column headers with the row and
 * column being filled lit. The composition (headers included) is centered on x = 0.
 */
import { useCallback, useMemo } from 'react';
import { useAnimTiming, useHighlight } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Arrow } from '../../scene/primitives/Arrow';
import { DeltaLabel } from '../../scene/primitives/DeltaLabel';
import { cellPosition, gridSize, type GridGeometry } from '../../scene/primitives/grid';
import { Grid2D, type GridMark } from '../../scene/primitives/Grid2D';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { EMPTY } from '../dp1d/table';
import type { VizProps } from '../types';
import type { Dp2dBindings } from './detect';
import { buildDp2dModel, CELL, GAP } from './model';

type Vec3 = [number, number, number];

const SEP = '\n';
const PITCH = CELL + GAP;
/** room left of the board for the row headers, above it for the column headers and the title */
const HEADER_W = PITCH * 1.2;
const COL_HEADER_H = PITCH * 1.05;
const TITLE_H = 0.55;
/** arrows float just in front of the tiles and their labels */
const ARROW_Z = 0.22;
/** beyond this many rows / columns the headers are left out */
const HEADER_LIMIT = 60;

/** An arrow from cell center `a` to `b`, trimmed to start and end near the cell edges. */
function trimmed(a: Vec3, b: Vec3): [Vec3, Vec3] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  return [[a[0] + ux * 0.26, a[1] + uy * 0.26, ARROW_Z], [b[0] - ux * 0.3, b[1] - uy * 0.3, ARROW_Z]];
}

export function Dp2dView({ view, detection }: VizProps<Dp2dBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const m = useMemo(() => buildDp2dModel(view.tl, view.i, b, hl), [view, b, hl]);
  const { rows, cols } = m;
  const geo = useMemo<GridGeometry>(() => ({ rows, cols, cell: CELL, gap: GAP }), [rows, cols]);
  const { w, h } = gridSize(geo);
  const width = HEADER_W + w;
  const height = h + COL_HEADER_H + TITLE_H;
  const gridX = -width / 2 + HEADER_W + w / 2;
  const stepKey = hl?.key ?? String(view.i);
  useReportSize({ w: width + 0.6, h: height, d: 1.4 });

  // keyed by content: Grid2D re-targets its tiles only when a color actually changes
  const colorKey = m.color.join(SEP);
  const labelKey = m.text.map((t, k) => (m.state[k] === 'empty' ? '' : t)).join(SEP);
  const inkKey = m.ink.join(SEP);
  const colors = useMemo(() => colorKey.split(SEP), [colorKey]);
  const labels = useMemo(() => labelKey.split(SEP), [labelKey]);
  const inks = useMemo(() => inkKey.split(SEP), [inkKey]);
  const colorOf = useCallback((r: number, c: number) => colors[r * cols + c] ?? EMPTY, [colors, cols]);
  const labelOf = useCallback((r: number, c: number) => labels[r * cols + c] ?? '', [labels, cols]);
  const labelColorOf = useCallback((r: number, c: number) => inks[r * cols + c] ?? COLORS.ink, [inks, cols]);
  const marks = useMemo(() => {
    const out: GridMark[] = m.deps.map((d) => ({ r: d.r, c: d.c, color: COLORS.current }));
    if (m.written) out.push({ r: m.written.r, c: m.written.c, color: COLORS.changed, pulseKey: stepKey });
    return out;
  }, [m.deps, m.written, stepKey]);

  const at = (r: number, c: number): Vec3 => {
    const [x, y] = cellPosition(geo, r, c);
    return [gridX + x, y, 0];
  };
  useFocusPoint(detection.key, m.exists && m.focus ? at(m.focus.r, m.focus.c) : null, 2, stepKey);
  const target = m.written ? at(m.written.r, m.written.c) : null;
  const headers = m.exists && rows <= HEADER_LIMIT && cols <= HEADER_LIMIT;
  const headerSize = CELL * 0.3;
  return (
    <group>
      <Label text={`${detection.title} · DP`} position={[-width / 2, height - 0.25, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      {m.exists ? (
        <group position={[gridX, 0, 0]}>
          <Grid2D rows={rows} cols={cols} cell={CELL} gap={GAP} colorOf={colorOf} labelOf={labelOf} labelColorOf={labelColorOf}
            marks={marks} timing={timing} />
        </group>
      ) : (
        <Label text="(not created yet)" position={[0, h / 2, 0]} size={0.28} color={COLORS.inkFaint} />
      )}
      {headers && m.rowHeaders.map((text, r) => {
        if (!text) return null;
        const [x, y] = at(r, 0);
        return (
          <Label key={`r${r}`} text={text} position={[x - PITCH * 0.85, y, 0]} size={headerSize}
            color={m.current?.r === r ? COLORS.current : COLORS.inkDim} />
        );
      })}
      {headers && m.colHeaders.map((text, c) => {
        if (!text) return null;
        const [x, y] = at(0, c);
        return (
          <Label key={`c${c}`} text={text} position={[x, y + PITCH * 0.8, 0]} size={headerSize}
            color={m.current?.c === c ? COLORS.current : COLORS.inkDim} />
        );
      })}
      {target && m.deps.map((d) => {
        const [from, to] = trimmed(at(d.r, d.c), target);
        return (
          <Arrow key={`${d.r}:${d.c}`} from={from} to={to} color={COLORS.current} bend={0.6} radius={0.03} headSize={0.16} glow={1.4} />
        );
      })}
      {target && m.delta && (
        <DeltaLabel position={[target[0] + PITCH * 0.75, target[1] + PITCH * 0.7, 0.6]} text={m.delta.text} changeKey={stepKey} />
      )}
    </group>
  );
}
