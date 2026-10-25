/**
 * A stack as a column of blocks on a base plate, bottom → top: a push drops the new block in from above
 * (pulsing orange), a pop lifts the top block off and fades it, a peek flashes the top block amber, and
 * the "top" marker follows the top block. A monotonic stack grades its blocks by value and shows why a
 * block was evicted (`2 < 4`). Stepping back plays it all in reverse.
 */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import { useMemo, useState } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker } from '../../scene/primitives/Markers';
import { COLORS, SURFACE } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { StackBindings } from './detect';
import { buildStackModel, stackRows, type ItemModel, type LeavingModel } from './model';

type Vec3 = [number, number, number];

const ITEM: Vec3 = [1.4, 0.6, 0.6];
const PITCH = ITEM[1] + 0.08;
const HALF = ITEM[0] / 2;
const FRONT = ITEM[2] / 2 + 0.012;
/** how far items drop in from and rise away to */
const LIFT = 1;
const IDLE_GLOW = 0.06;
const TITLE = 0.3;
/** where the index column and eviction reasons end (right-aligned) and the title starts */
const LEFT = -HALF - 0.16;

const slotY = (slot: number) => 0.04 + ITEM[1] / 2 + slot * PITCH;
/** label size keeping the text on the block face (a monospace glyph is ~0.6 em wide) */
const fitSize = (text: string) => Math.min(0.28, (ITEM[0] * 0.86) / (0.6 * Math.max(1, [...text].length)));

const AnimatedMaterial = animated('meshPhysicalMaterial');
const AnimatedLabel = animated(Label);

interface Motion {
  y: SpringValue<number>;
  z: SpringValue<number>;
  /** opacity of the block and its text */
  o: SpringValue<number>;
}

function ItemBlock({ text, color, motion, glow, timing }: {
  text: string;
  color: string;
  motion: Motion;
  glow: SpringValue<number> | number;
  timing: AnimTiming;
}) {
  const tint = useSpring({ color, config: timing.config, immediate: timing.immediate });
  return (
    <animated.group position-y={motion.y} position-z={motion.z} visible={motion.o.to((o) => o > 0.004)}>
      <RoundedBox args={ITEM} radius={0.07} smoothness={3} castShadow receiveShadow>
        <AnimatedMaterial {...SURFACE} color={tint.color} emissive={tint.color} emissiveIntensity={glow}
          transparent opacity={motion.o} depthWrite={motion.o.to((o) => o > 0.98)} toneMapped={false} />
      </RoundedBox>
      <AnimatedLabel text={text} position={[0, 0, FRONT]} size={fitSize(text)} opacity={motion.o} />
    </animated.group>
  );
}

/** An element on the stack: drops in when pushed (fades in place when it shows up otherwise), then keeps its slot. */
function StackItem({ item, stepKey, timing }: { item: ItemModel; stepKey: string; timing: AnimTiming }) {
  const y = slotY(item.slot);
  const [from] = useState(() => ({ y: item.isNew ? y + LIFT : y, z: 0, o: 0 }));
  const motion = useSpring({ from, to: { y, z: 0, o: 1 }, config: timing.config, immediate: timing.immediate });
  const glow = usePulse(`${stepKey}:${item.key}`, item.state !== 'idle', IDLE_GLOW);
  return <ItemBlock text={item.text} color={item.color} motion={motion} glow={glow} timing={timing} />;
}

/** An element leaving at this step: rises off the top, drifting back, and fades out — with the reason when evicted. */
function LeavingItem({ item, timing }: { item: LeavingModel; timing: AnimTiming }) {
  const y = slotY(item.slot);
  const [from] = useState(() => ({ y, z: 0, o: 1 }));
  const motion = useSpring({ from, to: { y: y + LIFT, z: -0.3, o: 0 }, config: timing.config, immediate: timing.immediate });
  return (
    <>
      <ItemBlock text={item.text} color={item.color} motion={motion} glow={0.3} timing={timing} />
      {item.reason && (
        <animated.group position-y={motion.y}>
          <AnimatedLabel text={item.reason} position={[LEFT, 0, 0.1]} anchorX="right" size={0.22} color={COLORS.error} opacity={motion.o} />
        </animated.group>
      )}
    </>
  );
}

export function StackView({ view, detection }: VizProps<StackBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const model = useMemo(() => buildStackModel(view.tl, view.i, b, hl), [view, b, hl]);
  const stepKey = hl?.key ?? String(view.i);
  const mono = b.monotonic;
  const title = `${detection.title} · stack`;
  // sized for the tallest stack of the run, so the layout and the camera don't breathe with every push
  const titleY = slotY(stackRows(view.tl, b) - 1) + ITEM[1] / 2 + (mono ? 0.95 : 0.55);
  const halfW = Math.max(HALF + 1.05, LEFT + title.length * 0.6 * TITLE);
  useReportSize({ w: 2 * halfW, h: titleY + 0.4, d: 1.2 });
  const top = model.items[model.items.length - 1];
  useFocusPoint(detection.key, model.exists ? [0, slotY(top?.slot ?? 0), 0] : null, 2, stepKey);
  return (
    <group>
      <Label text={title} position={[LEFT, titleY, 0]} anchorX="left" size={TITLE} color={COLORS.inkDim} />
      {mono && (
        <Label text={`monotonic ${mono.direction === 'decreasing' ? '↓' : '↑'}`} position={[LEFT, titleY - 0.42, 0]} anchorX="left"
          size={0.24} color={COLORS.window} />
      )}
      <mesh position={[0, -0.03, 0]} receiveShadow>
        <boxGeometry args={[ITEM[0] + 0.4, 0.06, ITEM[2] + 0.4]} />
        <meshStandardMaterial color={COLORS.surface} roughness={0.6} />
      </mesh>
      {!model.items.length && (
        <Label text={model.exists ? '(empty)' : '(not created yet)'} position={[0, slotY(0), 0]} size={0.22} color={COLORS.inkFaint} />
      )}
      {model.items.map((it) => <StackItem key={it.key} item={it} stepKey={stepKey} timing={timing} />)}
      {model.items.map((it) => (
        <Label key={`ix${it.slot}`} text={String(it.index)} position={[LEFT, slotY(it.slot), 0.1]} anchorX="right" size={0.2}
          color={COLORS.inkFaint} />
      ))}
      {model.leaving.map((it) => <LeavingItem key={`${it.key}:${stepKey}`} item={it} timing={timing} />)}
      {top && (
        // the marker points down: a quarter turn makes it point left, at the top block
        <group rotation={[0, 0, -Math.PI / 2]}>
          <PointerMarker x={-slotY(top.slot)} y={HALF + 0.12} label="top" color={COLORS.current} timing={timing} />
        </group>
      )}
      {model.hiddenBelow > 0 && (
        <Label text={`… ${model.hiddenBelow} more below`} position={[0, -0.36, 0.3]} size={0.2} color={COLORS.inkFaint} />
      )}
    </group>
  );
}
