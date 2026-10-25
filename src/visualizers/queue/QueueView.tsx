/**
 * The queue as a conveyor: items front (left) → rear (right) on a low track under "front" / "rear" markers.
 * Enqueued items slide in from the right, dequeued ones slide out to the left and fade while the rest glide
 * forward; a priority queue shows "priority · value", glows the next item amber and re-sorts in place.
 * Stepping back plays every motion in reverse.
 */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker } from '../../scene/primitives/Markers';
import { COLORS, SURFACE } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { QueueBindings, QueueMode } from './detect';
import { buildQueueModel, SPACING, type ItemModel, type LeavingModel } from './model';

type Vec3 = [number, number, number];

const ITEM: Vec3 = [0.94, 0.78, 0.8];
const TRACK_H = 0.1;
const TRACK_D = ITEM[2] + 0.42;
const ITEM_Y = TRACK_H + 0.02 + ITEM[1] / 2;
const MARKER_Y = ITEM_Y + ITEM[1] / 2 + 0.22;
/** above two stacked markers (front and rear on the same item) */
const TITLE_Y = MARKER_Y + 1.6;
/** how far items slide in and out past the ends */
const SLIDE = SPACING * 1.15;
const HOP = 0.55;

const KIND: Record<QueueMode, string> = { fifo: 'queue', deque: 'deque', priority: 'priority queue' };

interface Look {
  color: string;
  emissive: string;
  glow: number;
}

const LOOK: Record<'idle' | 'arriving' | 'next' | 'gone', Look> = {
  idle: { color: COLORS.idle, emissive: COLORS.idle, glow: 0.06 },
  arriving: { color: COLORS.changed, emissive: COLORS.changed, glow: 0.12 },
  // just past the bloom threshold: the item extracted next glows
  next: { color: '#6b4c12', emissive: COLORS.current, glow: 1.1 },
  gone: { color: '#1d3157', emissive: COLORS.visited, glow: 0.25 },
};

const lookOf = (it: ItemModel) => (it.next ? LOOK.next : it.enter ? LOOK.arriving : LOOK.idle);

/** font size that fits a label on an item's face (a monospace character is 0.6 × the size wide) */
const textSize = (label: string) => Math.min(0.28, (ITEM[0] - 0.14) / (0.6 * Math.max(1, label.length)));

const AnimatedMaterial = animated('meshPhysicalMaterial');
const AnimatedLabel = animated(Label);

interface Motion {
  x: SpringValue<number>;
  /** opacity of the item and its label */
  o: SpringValue<number>;
}

interface Tint {
  color: SpringValue<string>;
  emissive: SpringValue<string>;
}

function ItemBody({ label, motion, z, tint, glow }: {
  label: string;
  motion: Motion;
  z: SpringValue<number> | number;
  tint: Tint;
  glow: SpringValue<number> | number;
}) {
  return (
    <animated.group position-x={motion.x} position-y={ITEM_Y} position-z={z} visible={motion.o.to((o) => o > 0.004)}>
      <RoundedBox args={ITEM} radius={0.08} smoothness={3} castShadow receiveShadow>
        <AnimatedMaterial {...SURFACE} color={tint.color} emissive={tint.emissive} emissiveIntensity={glow}
          transparent opacity={motion.o} depthWrite={motion.o.to((o) => o > 0.98)} toneMapped={false} />
      </RoundedBox>
      <AnimatedLabel text={label} position={[0, 0, ITEM[2] / 2 + 0.012]} size={textSize(label)} opacity={motion.o} />
    </animated.group>
  );
}

/** Items re-sorted past each other: the one moving back swings forward, the one moving ahead swings back. */
function useHop(slot: number, active: boolean, timing: AnimTiming): SpringValue<number> {
  const prev = useRef(slot);
  const [spring, api] = useSpring(() => ({ z: 0 }));
  useEffect(() => {
    const from = prev.current;
    prev.current = slot;
    if (!active || from === slot || timing.immediate || timing.direction === 'jump') return;
    const half = Math.max(30, Number(timing.config.duration ?? 400) / 2);
    api.start({ to: [{ z: slot > from ? HOP : -HOP }, { z: 0 }], config: { duration: half } });
  }, [slot, active, api, timing]);
  return spring.z;
}

/** An item on the conveyor: slides in through its end when it arrives (fades in place otherwise), then follows its slot. */
function QueueItem({ item, stepKey, resorted, timing }: { item: ItemModel; stepKey: string; resorted: boolean; timing: AnimTiming }) {
  const look = lookOf(item);
  const [from] = useState(() => ({ x: item.enter ? item.x + (item.enter === 'rear' ? SLIDE : -SLIDE) : item.x, o: 0 }));
  const motion = useSpring({ from, to: { x: item.x, o: 1 }, config: timing.config, immediate: timing.immediate });
  const tint = useSpring({ color: look.color, emissive: look.emissive, config: timing.config, immediate: timing.immediate });
  const glow = usePulse(`${stepKey}:${item.key}`, item.enter !== null, look.glow);
  const z = useHop(item.slot, resorted, timing);
  return <ItemBody label={item.label} motion={motion} z={z} tint={tint} glow={glow} />;
}

/** An item leaving at this step: slides out through its end, turning blue and fading (drawn from the neighbouring step). */
function LeavingItem({ item, timing }: { item: LeavingModel; timing: AnimTiming }) {
  const was = lookOf(item);
  const [from] = useState(() => ({ x: item.x, o: 1, color: was.color, emissive: was.emissive }));
  const motion = useSpring({
    from,
    to: { x: item.x + (item.exit === 'front' ? -SLIDE : SLIDE), o: 0, color: LOOK.gone.color, emissive: LOOK.gone.emissive },
    config: timing.config,
    immediate: timing.immediate,
  });
  return <ItemBody label={item.label} motion={motion} z={0} tint={motion} glow={was.glow} />;
}

/** The low plate the items ride on, with rails and the way items flow at each end. */
function Track({ width, mode }: { width: number; mode: QueueMode }) {
  const [left, right] = mode === 'deque' ? ['↔', '↔'] : ['← out', '← in'];
  return (
    <group>
      <mesh position={[0, TRACK_H / 2, 0]} receiveShadow>
        <boxGeometry args={[width, TRACK_H, TRACK_D]} />
        <meshStandardMaterial color={COLORS.surface} roughness={0.6} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, TRACK_H + 0.03, side * (TRACK_D / 2 - 0.05)]}>
          <boxGeometry args={[width, 0.06, 0.06]} />
          <meshStandardMaterial color={COLORS.idleLight} roughness={0.4} metalness={0.3} />
        </mesh>
      ))}
      <Label text={left} position={[-width / 2 - 0.2, ITEM_Y, 0]} anchorX="right" size={0.22} color={COLORS.inkFaint} />
      <Label text={right} position={[width / 2 + 0.2, ITEM_Y, 0]} anchorX="left" size={0.22} color={COLORS.inkFaint} />
    </group>
  );
}

export function QueueView({ view, detection }: VizProps<QueueBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const model = useMemo(() => buildQueueModel(view.tl, view.i, b, hl), [view, b, hl]);
  const stepKey = hl?.key ?? String(view.i);
  const width = model.maxLen * SPACING + 0.3;
  // sized for the longest queue of the run, so the layout and the camera don't breathe with every enqueue
  useReportSize({ w: width + 2.2, h: TITLE_Y + 0.4, d: TRACK_D + 0.4 });
  useFocusPoint(detection.key, model.focusX === null ? null : [model.focusX, ITEM_Y, 0], 2, stepKey);
  const front = model.items[0];
  const rear = model.items[model.items.length - 1];
  return (
    <group>
      <Label text={`${detection.title} · ${KIND[b.mode]}`} position={[-width / 2, TITLE_Y, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      <Track width={width} mode={b.mode} />
      {!model.exists && <Label text="(not created yet)" position={[0, ITEM_Y, 0]} size={0.26} color={COLORS.inkFaint} />}
      {model.exists && !model.items.length && <Label text="(empty)" position={[0, ITEM_Y, 0]} size={0.24} color={COLORS.inkFaint} />}
      {model.items.map((it) => <QueueItem key={it.key} item={it} stepKey={stepKey} resorted={model.resorted} timing={timing} />)}
      {model.leaving.map((it) => <LeavingItem key={`${it.key}:${stepKey}`} item={it} timing={timing} />)}
      {front && (
        <PointerMarker x={front.x} y={MARKER_Y} timing={timing} color={COLORS.window}
          label={b.head && model.headIndex !== null ? `${b.head.name} = ${model.headIndex}` : 'front'} />
      )}
      {rear && <PointerMarker x={rear.x} y={MARKER_Y} label="rear" color={COLORS.frontier} stack={rear === front ? 1 : 0} timing={timing} />}
    </group>
  );
}
