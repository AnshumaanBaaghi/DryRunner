/**
 * Fallback stage for code without data structures: scalar variable cards (pulse + old → new on change),
 * a progress ring per active loop, and the iteration-space grid of nested loops.
 */
import { useMemo } from 'react';
import { frameById, visibleVars } from '../../engine/timeline/scope';
import type { FrameSnap } from '../../engine/timeline/types';
import { isObj, previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import { useAnimTiming, useHighlight } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Block } from '../../scene/primitives/Block';
import { DeltaLabel } from '../../scene/primitives/DeltaLabel';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import { useViz } from '../../state/vizStore';
import type { VizProps } from '../types';
import { iterationSpace } from './iterations';
import { LoopRing } from './LoopRing';

const CARD_W = 2.3;
const CARD_H = 1.15;
const GAP_X = 0.3;
const GAP_Y = 0.35;
const COLS = 4;
const RING_GAP = 2.2;
const CELL = 0.62;

interface Card {
  bid: number;
  name: string;
  value: string;
  state: 'new' | 'changed' | 'same' | 'idle';
  delta?: string;
}

function CardView({ card, x, y, stepKey }: { card: Card; x: number; y: number; stepKey: string }) {
  const timing = useAnimTiming();
  const active = card.state !== 'idle';
  const pulse = usePulse(`${stepKey}:${card.bid}`, active);
  const color = card.state === 'changed' || card.state === 'same' ? '#5a3b1f' : card.state === 'new' ? '#1d4d33' : COLORS.surface;
  return (
    <group>
      <Block position={[x, y, 0]} size={[CARD_W, CARD_H, 0.28]} color={color}
        emissive={!active ? undefined : card.state === 'new' ? COLORS.done : COLORS.changed} pulse={pulse} timing={timing}>
        <Label text={card.name} position={[0, CARD_H * 0.27, 0.16]} size={0.2} color={COLORS.inkDim} />
        <Label text={card.value} position={[0, -CARD_H * 0.1, 0.16]} size={0.36} color={COLORS.ink} maxWidth={CARD_W - 0.2} />
      </Block>
      {card.delta && <DeltaLabel position={[x, y + CARD_H / 2 + 0.45, 0.3]} text={card.delta} changeKey={`${stepKey}:${card.bid}`} />}
    </group>
  );
}

export function ScalarsView({ view, detection }: VizProps<Record<string, never>>) {
  const hl = useHighlight(view);
  const hiddenVars = useViz((s) => s.hiddenVars);
  const { tl, snap, step } = view;
  const stepKey = hl?.key ?? String(view.i);
  const cards = useMemo(() => {
    const frame = frameById(snap, step.callId) ?? (snap.frames.last() as FrameSnap);
    const frames = frame.callId === 0 ? [frame] : [frame, snap.frames.first() as FrameSnap];
    const out: Card[] = [];
    for (const f of frames) {
      for (const v of visibleVars(tl, f)) {
        if (isObj(v.slot.v) && 'r' in v.slot.v) continue;
        if (hiddenVars.includes(v.name) || out.some((c) => c.name === v.name)) continue;
        const change = hl?.diff.vars.findLast((c) => c.bid === v.bid && c.callId === f.callId);
        const fmt = (x: V | undefined) => previewValue(tl, snap, x, { depth: 0, maxString: 14 });
        let delta: string | undefined;
        if (change?.kind === 'changed' && change.old !== undefined) {
          delta = hl?.reversed ? `${fmt(change.value)} → ${fmt(change.old)}` : `${fmt(change.old)} → ${fmt(change.value)}`;
        }
        out.push({ bid: v.bid, name: v.name, value: fmt(v.slot.v), state: change ? change.kind : 'idle', delta });
        if (out.length >= 12) break;
      }
    }
    return out;
  }, [tl, snap, step, hl, hiddenVars]);

  const loops = step.loops;
  const outer = loops.length >= 2 ? loops[loops.length - 2] : null;
  const inner = loops.length >= 2 ? loops[loops.length - 1] : null;
  const space = useMemo(() => (outer && inner ? iterationSpace(tl, outer, inner.loopId) : null), [tl, outer, inner]);

  // composition: variable cards (bottom left), loop rings above them, iteration grid on the right
  const cols = Math.min(COLS, Math.max(1, cards.length));
  const rows = Math.max(1, Math.ceil(cards.length / COLS));
  const cardsW = cols * (CARD_W + GAP_X) - GAP_X;
  const cardsH = rows * (CARD_H + GAP_Y) - GAP_Y;
  const leftW = Math.max(cardsW, loops.length * RING_GAP);
  const ringsY = cardsH + 1.3;
  const gridW = space ? space.cols * CELL : 0;
  const gridH = space ? space.rows * CELL : 0;
  const width = leftW + (space ? 1.4 + gridW : 0);
  const height = Math.max(cardsH + (loops.length ? 2.5 : 0), gridH + 0.9);
  useReportSize({ w: width + 0.6, h: height, d: 1 });
  const leftX = -width / 2 + leftW / 2;
  const gridX = width / 2 - gridW;

  const posOf = (k: number) => {
    const r = Math.floor(k / COLS);
    const c = k % COLS;
    const inRow = Math.min(COLS, cards.length - r * COLS);
    return [leftX + (c - (inRow - 1) / 2) * (CARD_W + GAP_X), (rows - 1 - r) * (CARD_H + GAP_Y) + CARD_H / 2] as const;
  };
  const changedIdx = cards.findIndex((c) => c.state !== 'idle');
  useFocusPoint(detection.key, changedIdx >= 0 ? [posOf(changedIdx)[0], posOf(changedIdx)[1], 0] : null, 1, stepKey);
  const counterOf = (loopId: number) => tl.meta.loops[loopId]?.counters[0] ?? `line ${tl.meta.loops[loopId]?.loc.line ?? '?'}`;

  return (
    <group>
      {cards.length === 0 && <Label text="no variables yet" position={[0, 0.6, 0]} size={0.3} color={COLORS.inkFaint} />}
      {cards.map((c, k) => {
        const [x, y] = posOf(k);
        return <CardView key={c.bid} card={c} x={x} y={y} stepKey={stepKey} />;
      })}
      {loops.map((l, k) => {
        const inst = tl.loops.get(l.inst);
        const meta = tl.meta.loops[l.loopId];
        return (
          <LoopRing key={l.inst} x={leftX + (k - (loops.length - 1) / 2) * RING_GAP} y={ringsY} iteration={l.iteration}
            total={inst?.endStep !== undefined ? inst.iterations : null} label={`loop · line ${meta?.loc.line ?? '?'}`} />
        );
      })}
      {space && outer && inner && (
        <group position={[gridX, 0, 0]}>
          <Label text={`iterations ${counterOf(outer.loopId)} × ${counterOf(inner.loopId)}`}
            position={[gridW / 2, gridH + 0.42, 0]} size={0.24} color={COLORS.inkDim} />
          {Array.from({ length: space.rows * space.cols }, (_, k) => {
            const r = Math.floor(k / space.cols) + 1;
            const c = (k % space.cols) + 1;
            const first = space.firstStep.get(`${r}:${c}`);
            if (first === undefined) return null;
            const current = r === outer.iteration && c === inner.iteration;
            const visited = first <= view.i;
            return (
              <mesh key={k} position={[(c - 0.5) * CELL, gridH - (r - 0.5) * CELL, 0]}>
                <boxGeometry args={[CELL * 0.86, CELL * 0.86, 0.14]} />
                <meshStandardMaterial
                  color={current ? COLORS.current : visited ? COLORS.visited : '#273449'}
                  emissive={current ? COLORS.current : visited ? COLORS.visited : '#000000'}
                  emissiveIntensity={current ? 1.4 : visited ? 0.35 : 0}
                  toneMapped={false}
                />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
}
