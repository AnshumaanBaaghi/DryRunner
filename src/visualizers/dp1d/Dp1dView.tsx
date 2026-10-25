/**
 * A 1D DP table as a row of blocks: computed cells blue, cells not computed yet dark, this step's write
 * pulsing orange with glowing arcs from the cells it read (amber), the loop index above, "old → new" on top.
 */
import { useMemo } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Arrow } from '../../scene/primitives/Arrow';
import { Block } from '../../scene/primitives/Block';
import { DeltaLabel } from '../../scene/primitives/DeltaLabel';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker } from '../../scene/primitives/Markers';
import { COLORS } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { Dp1dBindings } from './detect';
import {
  arcBend, ARROW_Y, BLOCK, BLOCK_Y, buildDp1dModel, DELTA_Y, HEIGHT, INDEX_Y, POINTER_Y, SPACING, TITLE_Y, type Dp1dCell,
} from './model';

/** beyond this many cells the index row is left out */
const INDEX_LIMIT = 60;

/** Label size keeping longer values (`1.2e6`) on the block face (glyphs are ~0.6 em wide). */
const fitSize = (text: string) => Math.min(0.32, (BLOCK * 0.9) / (0.6 * Math.max(1, [...text].length)));

function CellBlock({ cell, stepKey, timing, showIndex }: { cell: Dp1dCell; stepKey: string; timing: AnimTiming; showIndex: boolean }) {
  const pulse = usePulse(stepKey, cell.state === 'written');
  return (
    <group>
      <Block position={[cell.x, BLOCK_Y, 0]} size={[BLOCK, BLOCK, BLOCK]} color={cell.color} pulse={pulse}
        label={cell.state === 'empty' ? undefined : cell.text} labelSize={fitSize(cell.text)} timing={timing} />
      {showIndex && <Label text={String(cell.index)} position={[cell.x, INDEX_Y, 0.45]} size={0.2} color={COLORS.inkFaint} />}
    </group>
  );
}

export function Dp1dView({ view, detection }: VizProps<Dp1dBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const m = useMemo(() => buildDp1dModel(view.tl, view.i, b, hl), [view, b, hl]);
  const width = m.maxLen * SPACING;
  const stepKey = hl?.key ?? String(view.i);
  useReportSize({ w: width + 1.2, h: HEIGHT, d: 1.6 });
  const focusX = m.focusIndex === null ? null : m.cells[m.focusIndex]?.x ?? null;
  useFocusPoint(detection.key, focusX === null ? null : [focusX, BLOCK_Y, 0], 2, stepKey);
  const target = m.written === null ? undefined : m.cells[m.written];
  const delta = m.delta ? m.cells[m.delta.index] : undefined;
  return (
    <group>
      <Label text={`${detection.title} · DP`} position={[-width / 2 - 0.2, TITLE_Y, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      {!m.exists && <Label text="(not created yet)" position={[0, BLOCK_Y, 0]} size={0.28} color={COLORS.inkFaint} />}
      {m.cells.map((cell) => (
        <CellBlock key={cell.index} cell={cell} stepKey={stepKey} timing={timing} showIndex={m.maxLen <= INDEX_LIMIT} />
      ))}
      {target && m.deps.map(({ from }) => {
        const source = m.cells[from];
        if (!source) return null;
        return (
          <Arrow key={`${from}>${target.index}`} from={[source.x, ARROW_Y, 0]} to={[target.x, ARROW_Y, 0]} color={COLORS.current}
            bend={arcBend(Math.abs(target.x - source.x))} radius={0.035} headSize={0.18} glow={1.5} />
        );
      })}
      {m.pointer && <PointerMarker x={m.pointer.x} y={POINTER_Y} label={m.pointer.name} color={COLORS.visited} timing={timing} />}
      {m.delta && delta && <DeltaLabel position={[delta.x, DELTA_Y, 0.6]} text={m.delta.text} changeKey={stepKey} />}
    </group>
  );
}
