/**
 * A hash map or set as a grid of cards in insertion order — "key → value" (Map), the key (Set),
 * "key: value" (object): an added entry drops in with an orange pulse, an updated one pulses under its
 * old → new, a removed one rises and fades, a lookup flashes the card it finds amber or pops a red
 * "miss" chip on the size line. Stepping back plays the undone step backwards. Centered on x = 0.
 */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Block } from '../../scene/primitives/Block';
import { DeltaLabel } from '../../scene/primitives/DeltaLabel';
import { Label } from '../../scene/primitives/Label';
import { COLORS, SURFACE } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { HashMapBindings } from './detect';
import { glyphSafe, missText } from './entries';
import { buildHashModel, hashExtent, type CardModel, type LeavingModel } from './model';
import {
  CARD, CHIP_H, CHIP_SIZE, chipCenter, chipWidth, fitText, hashLayout, NOTE_SIZE, slotCenter, STATS_SIZE, STATS_Y, TITLE_SIZE, titleText,
} from './panel';

const AnimatedMaterial = animated('meshPhysicalMaterial');
const AnimatedLabel = animated(Label);
/** how far an added card drops in from (and a removed one rises to) */
const DROP = 0.8;

/** Replays a drop-in (from DROP above) whenever `active` turns on for a new step key. */
function useDrop(key: string, active: boolean, timing: AnimTiming): SpringValue<number> {
  // a card mounted by an addition starts up high, so its first frame is not drawn in place
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

function HashCard({ card, x, y, w, stepKey, timing }: { card: CardModel; x: number; y: number; w: number; stepKey: string; timing: AnimTiming }) {
  const pulse = usePulse(stepKey, card.pulse);
  const drop = useDrop(stepKey, card.entered, timing);
  return (
    <group>
      <animated.group position-y={drop}>
        <Block position={[x, y, 0]} size={[w, CARD.h, CARD.d]} color={card.color} pulse={pulse} label={card.text}
          labelSize={fitText(card.text, w)} timing={timing} />
      </animated.group>
      {card.delta && !timing.immediate && (
        <DeltaLabel position={[x, y + CARD.h / 2 + 0.32, 0.3]} text={card.delta} changeKey={`${stepKey}:${card.id}`} />
      )}
    </group>
  );
}

/** A removed entry rising out of its slot and fading (mounted per step key, so each removal replays it). */
function LeavingCard({ card, x, y, w, timing }: { card: LeavingModel; x: number; y: number; w: number; timing: AnimTiming }) {
  const spring = useSpring({ from: { y: 0, z: 0, o: 0.85 }, to: { y: DROP, z: -0.3, o: 0 }, config: timing.config });
  return (
    <animated.group position-x={x} position-y={spring.y.to((dy) => y + dy)} position-z={spring.z}>
      <RoundedBox args={[w, CARD.h, CARD.d]} radius={CARD.h * 0.12} smoothness={3}>
        <AnimatedMaterial {...SURFACE} color={card.color} emissive={card.color} emissiveIntensity={0.5} transparent
          opacity={spring.o} depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <AnimatedLabel text={card.text} position={[0, 0, CARD.d / 2 + 0.02]} size={fitText(card.text, w)} opacity={spring.o} />
    </animated.group>
  );
}

/** The keys a lookup missed: a red chip popping up on the size line, then fading (mounted per step key). */
function MissChip({ text, at }: { text: string; at: [number, number] }) {
  const spring = useSpring({ from: { o: 1, s: 0.6 }, to: [{ s: 1, config: { duration: 160 } }, { o: 0, delay: 700, config: { duration: 500 } }] });
  const w = chipWidth(text);
  return (
    <animated.group position={[at[0], at[1], 0.05]} scale={spring.s}>
      <RoundedBox args={[w, CHIP_H, 0.08]} radius={0.06} smoothness={3}>
        <AnimatedMaterial {...SURFACE} color="#5c1d1d" emissive={COLORS.error} emissiveIntensity={0.7} transparent opacity={spring.o}
          depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <AnimatedLabel text={text} position={[0, 0, 0.06]} size={CHIP_SIZE} color={COLORS.ink} opacity={spring.o} />
    </animated.group>
  );
}

export function HashMapView({ view, detection }: VizProps<HashMapBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const m = useMemo(() => buildHashModel(view.tl, view.i, b, hl), [view, b, hl]);
  const title = glyphSafe(titleText(detection.title, b.kind));
  // sized for the most entries of the run, so the layout and the camera don't breathe with every insert
  const g = hashLayout(hashExtent(view.tl, b), b.kind, title);
  const stepKey = hl?.key ?? String(view.i);
  useReportSize({ w: g.w + 0.4, h: g.h, d: 1.2 });
  const miss = m.misses.length ? missText(m.misses) : null;
  const focus = m.focus !== null ? slotCenter(g, m.focus) : miss ? chipCenter(g, miss) : null;
  useFocusPoint(detection.key, focus && [focus[0], focus[1], 0], 1, stepKey);
  const first = slotCenter(g, 0);
  return (
    <group>
      <Label text={title} position={[g.x0, g.titleY, 0]} anchorX="left" size={TITLE_SIZE} color={COLORS.inkDim} />
      {m.hidden > 0 && <Label text={`+${m.hidden} more`} position={[g.x0, g.noteY, 0]} anchorX="left" size={NOTE_SIZE} color={COLORS.inkFaint} />}
      {m.cards.length === 0 && (
        <Label text={m.exists ? '(empty)' : '(not created yet)'} position={[g.x0 + 0.05, first[1], 0]} anchorX="left" size={0.22}
          color={COLORS.inkFaint} />
      )}
      {m.cards.map((card, k) => {
        const [x, y] = slotCenter(g, k);
        return <HashCard key={card.id} card={card} x={x} y={y} w={g.cardW} stepKey={stepKey} timing={timing} />;
      })}
      {!timing.immediate && m.leaving.map((card) => {
        const [x, y] = slotCenter(g, card.slot);
        return <LeavingCard key={`${stepKey}:${card.id}`} card={card} x={x} y={y} w={g.cardW} timing={timing} />;
      })}
      <Label text={`size ${m.size}`} position={[g.x0, STATS_Y, 0]} anchorX="left" size={STATS_SIZE} color={COLORS.ink} />
      {miss && !timing.immediate && <MissChip key={stepKey} text={miss} at={chipCenter(g, miss)} />}
    </group>
  );
}
