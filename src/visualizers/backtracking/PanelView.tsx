/**
 * The backtracking side panel: the path as blocks (a push drops in, a pop lifts out), flags as small
 * blocks, the board as a Grid2D (placed cells raised gold, the changed cell pulsing orange, cells being
 * checked violet) and the solutions found so far.
 */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AnimTiming } from '../../scene/anim';
import { Block } from '../../scene/primitives/Block';
import { Grid2D, type GridMark } from '../../scene/primitives/Grid2D';
import { Label } from '../../scene/primitives/Label';
import { COLORS, SURFACE } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { BoardModel, PanelModel, ResultsModel, RowModel, SlotModel } from './model';
import { BOARD_CELL, BOARD_INSET, boardSize, DROP, ROW_BASE, rowTitleY, TITLE_SIZE, type PanelLayout, type SlotGeometry } from './panel';

const AnimatedMaterial = animated('meshPhysicalMaterial');
const CHECKER = ['#1a2332', '#273449'];
/** raise of a placed board cell (a queen) */
const PLACED_RAISE = 0.25;

/** Replays a drop-in (from DROP above) whenever `active` turns on for a new step key. */
function useDrop(key: string, active: boolean, timing: AnimTiming): SpringValue<number> {
  // a block mounted by a push starts up high, so its first frame is not drawn in place
  const [spring, api] = useSpring(() => ({ y: active && !timing.immediate ? DROP : 0 }));
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!active || last.current === key) return;
    last.current = key;
    if (timing.immediate) api.start({ y: 0, immediate: true });
    else api.start({ from: { y: DROP }, to: { y: 0 }, config: timing.config });
  }, [key, active, api, timing]);
  return spring.y;
}

function SlotBlock({ x, slot, size, stepKey, timing }: { x: number; slot: SlotModel; size: number; stepKey: string; timing: AnimTiming }) {
  const pulse = usePulse(stepKey, slot.pulse);
  const drop = useDrop(stepKey, slot.entered, timing);
  return (
    <group position={[x, 0, 0]}>
      <animated.group position-y={drop}>
        <Block position={[0, ROW_BASE + size / 2, 0]} size={[size, size, size]} color={slot.color} pulse={pulse} label={slot.label} timing={timing} />
      </animated.group>
      {slot.sub !== undefined && <Label text={slot.sub} position={[0, 0.14, 0]} size={0.18} color={COLORS.inkFaint} />}
    </group>
  );
}

/** A removed element rising and fading out (mounted per step key, so each pop replays it). */
function LeavingBlock({ x, label, size, timing }: { x: number; label: string; size: number; timing: AnimTiming }) {
  const spring = useSpring({ from: { y: 0, o: 0.85 }, to: { y: DROP, o: 0 }, config: timing.config });
  const y = ROW_BASE + size / 2;
  return (
    <animated.group position-x={x} position-y={spring.y}>
      <RoundedBox args={[size, size, size]} radius={size * 0.12} smoothness={3} position={[0, y, 0]}>
        <AnimatedMaterial {...SURFACE} color={COLORS.changed} emissive={COLORS.changed} emissiveIntensity={0.5} transparent
          opacity={spring.o} depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <animated.group scale={spring.o.to((o) => (o > 0.05 ? 1 : 0.0001))}>
        <Label text={label} position={[0, y, size / 2 + 0.02]} size={size * 0.36} />
      </animated.group>
    </animated.group>
  );
}

function SlotRow({ row, slot, stepKey, timing }: { row: RowModel; slot: SlotGeometry; stepKey: string; timing: AnimTiming }) {
  const xOf = (k: number) => slot.pitch * (k + 0.5);
  return (
    <group>
      <Label text={row.name} position={[0, rowTitleY(slot), 0]} anchorX="left" size={TITLE_SIZE} color={COLORS.inkDim} />
      {row.slots.length === 0 && (
        <Label text="(empty)" position={[0.05, ROW_BASE + slot.size / 2, 0]} anchorX="left" size={0.22} color={COLORS.inkFaint} />
      )}
      {row.slots.map((s, k) => <SlotBlock key={s.key} x={xOf(k)} slot={s} size={slot.size} stepKey={stepKey} timing={timing} />)}
      {row.leaving && !timing.immediate && (
        <LeavingBlock key={stepKey} x={xOf(row.leaving.index)} label={row.leaving.label} size={slot.size} timing={timing} />
      )}
    </group>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, k) => String(k));

function BoardView({ board, stepKey, timing }: { board: BoardModel; stepKey: string; timing: AnimTiming }) {
  const { w, h } = boardSize(board.rows, board.cols);
  const colorOf = useCallback((r: number, c: number) => (board.placed[r * board.cols + c] ? COLORS.current : CHECKER[(r + c) % 2]), [board]);
  const raiseOf = useCallback((r: number, c: number) => (board.placed[r * board.cols + c] ? PLACED_RAISE : 0), [board]);
  const labelOf = useCallback((r: number, c: number) => board.text[r * board.cols + c] ?? '', [board]);
  const labelColorOf = useCallback((r: number, c: number) => (board.placed[r * board.cols + c] ? COLORS.bg : COLORS.inkDim), [board]);
  const marks = useMemo(() => board.marks.map((m): GridMark => (
    m.kind === 'changed' ? { r: m.r, c: m.c, color: COLORS.changed, pulseKey: stepKey } : { r: m.r, c: m.c, color: COLORS.frontier }
  )), [board, stepKey]);
  const rowHeaders = useMemo(() => range(board.rows), [board.rows]);
  const colHeaders = useMemo(() => range(board.cols), [board.cols]);
  return (
    <group>
      <Label text={board.name} position={[0, h + 0.85, 0]} anchorX="left" size={TITLE_SIZE} color={COLORS.inkDim} />
      <group position={[BOARD_INSET + w / 2, 0, 0]}>
        {board.exists ? (
          <Grid2D rows={board.rows} cols={board.cols} {...BOARD_CELL} colorOf={colorOf} labelOf={labelOf} labelColorOf={labelColorOf}
            raiseOf={raiseOf} marks={marks} rowHeaders={rowHeaders} colHeaders={colHeaders} timing={timing} />
        ) : (
          <Label text="(not created yet)" position={[0, h / 2, 0]} size={0.26} color={COLORS.inkFaint} />
        )}
      </group>
    </group>
  );
}

function ResultsView({ results }: { results: ResultsModel }) {
  return (
    <group>
      <Label text={`solutions: ${results.count}`} position={[0, 0.72, 0]} anchorX="left" size={0.3}
        color={results.found ? COLORS.done : COLORS.ink} />
      {results.latest !== null && (
        <Label text={`last: ${results.latest}`} position={[0, 0.27, 0]} anchorX="left" size={0.2} color={COLORS.inkDim} />
      )}
    </group>
  );
}

export function PanelView({ model, layout, stepKey, timing }: { model: PanelModel; layout: PanelLayout; stepKey: string; timing: AnimTiming }) {
  return (
    <group>
      {layout.parts.map((p) => {
        const row = p.kind === 'path' ? model.path : p.kind === 'flags' ? model.flags : null;
        return (
          <group key={p.kind} position={[0, p.y, 0]}>
            {p.kind === 'results' && model.results && <ResultsView results={model.results} />}
            {p.kind === 'board' && model.board && <BoardView board={model.board} stepKey={stepKey} timing={timing} />}
            {row && p.slot && <SlotRow row={row} slot={p.slot} stepKey={stepKey} timing={timing} />}
          </group>
        );
      })}
    </group>
  );
}
