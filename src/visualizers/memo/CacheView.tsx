/**
 * The cache panel: one card per entry ("key → value") in insertion order — a stored entry drops in with
 * an orange pulse, the entry a cache hit reads flashes violet, stepping back over a store lifts its entry
 * out again — and the hit and entry counts underneath.
 */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import type { AnimTiming } from '../../scene/anim';
import { Block } from '../../scene/primitives/Block';
import { Label } from '../../scene/primitives/Label';
import { COLORS, SURFACE } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { CacheModel, CardModel } from './model';
import { CARD, NOTE_SIZE, slotCenter, STATS_SIZE, STATS_Y, TITLE_SIZE, type CacheLayout } from './panel';

const AnimatedMaterial = animated('meshPhysicalMaterial');
/** how far a stored card drops in from (and an undone one lifts out to) */
const DROP = 0.9;

/** Replays a drop-in (from DROP above) whenever `active` turns on for a new step key. */
function useDrop(key: string, active: boolean, timing: AnimTiming): SpringValue<number> {
  // a card mounted by a store starts up high, so its first frame is not drawn in place
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

function CacheCard({ card, x, y, w, stepKey, timing }: { card: CardModel; x: number; y: number; w: number; stepKey: string; timing: AnimTiming }) {
  const pulse = usePulse(stepKey, card.pulse);
  const drop = useDrop(stepKey, card.entered, timing);
  return (
    <animated.group position-y={drop}>
      <Block position={[x, y, 0]} size={[w, CARD.h, CARD.d]} color={card.color} pulse={pulse} label={card.text} labelSize={CARD.text} timing={timing} />
    </animated.group>
  );
}

/** A removed entry rising and fading out (mounted per step key, so each undone store replays it). */
function LeavingCard({ x, y, w, text, timing }: { x: number; y: number; w: number; text: string; timing: AnimTiming }) {
  const spring = useSpring({ from: { y: 0, o: 0.85 }, to: { y: DROP, o: 0 }, config: timing.config });
  return (
    <animated.group position-x={x} position-y={spring.y.to((dy) => y + dy)}>
      <RoundedBox args={[w, CARD.h, CARD.d]} radius={CARD.h * 0.12} smoothness={3}>
        <AnimatedMaterial {...SURFACE} color={COLORS.changed} emissive={COLORS.changed} emissiveIntensity={0.5} transparent
          opacity={spring.o} depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <animated.group scale={spring.o.to((o) => (o > 0.05 ? 1 : 0.0001))}>
        <Label text={text} position={[0, 0, CARD.d / 2 + 0.02]} size={CARD.text} />
      </animated.group>
    </animated.group>
  );
}

export function CacheView({ model, layout, stepKey, timing }: { model: CacheModel; layout: CacheLayout; stepKey: string; timing: AnimTiming }) {
  const first = slotCenter(layout, 0);
  const leaving = model.leaving ? slotCenter(layout, model.leaving.slot) : null;
  const hitNow = model.cards.some((c) => c.id === model.read && c.pulse);
  return (
    <group>
      <Label text={`${model.name} (cache)`} position={[0, layout.titleY, 0]} anchorX="left" size={TITLE_SIZE} color={COLORS.inkDim} />
      {model.hidden > 0 && (
        <Label text={`+${model.hidden} earlier`} position={[0, layout.noteY, 0]} anchorX="left" size={NOTE_SIZE} color={COLORS.inkFaint} />
      )}
      {model.cards.length === 0 && (
        <Label text={model.exists ? '(empty)' : '(not created yet)'} position={[0.05, first[1], 0]} anchorX="left" size={0.22} color={COLORS.inkFaint} />
      )}
      {model.cards.map((card, k) => {
        const [x, y] = slotCenter(layout, k);
        return <CacheCard key={card.id} card={card} x={x} y={y} w={layout.cardW} stepKey={stepKey} timing={timing} />;
      })}
      {model.leaving && leaving && !timing.immediate && (
        <LeavingCard key={stepKey} x={leaving[0]} y={leaving[1]} w={layout.cardW} text={model.leaving.text} timing={timing} />
      )}
      <Label text={`hits: ${model.hits} · entries: ${model.entries}`} position={[0, STATS_Y, 0]} anchorX="left" size={STATS_SIZE}
        color={hitNow ? COLORS.frontier : COLORS.ink} />
    </group>
  );
}
