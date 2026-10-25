/**
 * The call stack as slabs stacking upward: the current call on top (amber), its callers below (blue), a
 * returning call green with its value, a throwing one red. Calls drop in from above and finished ones
 * rise away; stepping back plays both in reverse.
 */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import { useMemo, useState } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Label } from '../../scene/primitives/Label';
import { COLORS, SURFACE } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import { maxStackDepth, type CallStackBindings } from './detect';
import { buildStackModel, clip, localsLine, MAX_FRAMES, type FrameModel, type FrameState } from './model';

type Vec3 = [number, number, number];

const SLAB: Vec3 = [3.6, 0.72, 0.5];
const PITCH = SLAB[1] + 0.12;
const PAD = 0.2;
const HEAD = 0.24;
const SUB = 0.19;
/** how far frames drop in from and rise away to */
const LIFT = 1;
const LEFT = -SLAB[0] / 2 + PAD;
const FRONT = SLAB[2] / 2 + 0.012;

/** characters per line at a font size (a monospace character is 0.6 × the size wide) */
const cellsAt = (size: number) => Math.floor((SLAB[0] - 2 * PAD) / (0.6 * size));
const slotY = (slot: number) => SLAB[1] / 2 + slot * PITCH;

const LOOK: Record<FrameState, { color: string; emissive: string; glow: number }> = {
  active: { color: '#4d3a12', emissive: COLORS.current, glow: 0.3 },
  waiting: { color: '#1d3157', emissive: COLORS.visited, glow: 0.1 },
  returning: { color: '#174d34', emissive: COLORS.done, glow: 0.28 },
  threw: { color: '#5c1d1d', emissive: COLORS.error, glow: 0.45 },
};

const AnimatedMaterial = animated('meshPhysicalMaterial');
const AnimatedLabel = animated(Label);

interface Motion {
  y: SpringValue<number>;
  z: SpringValue<number>;
  /** opacity of the slab and its text */
  o: SpringValue<number>;
}

function Slab({ frame, motion, glow, timing }: { frame: FrameModel; motion: Motion; glow: SpringValue<number> | number; timing: AnimTiming }) {
  const look = LOOK[frame.state];
  const tint = useSpring({ color: look.color, emissive: look.emissive, config: timing.config, immediate: timing.immediate });
  const ret = frame.returnText === undefined ? null : `→ ${clip(frame.returnText, 8)}`;
  const head = clip(frame.label, cellsAt(HEAD) - (ret ? ret.length + 2 : 0));
  return (
    <animated.group position-y={motion.y} position-z={motion.z} visible={motion.o.to((o) => o > 0.004)}>
      <RoundedBox args={SLAB} radius={0.06} smoothness={3}>
        <AnimatedMaterial {...SURFACE} color={tint.color} emissive={tint.emissive} emissiveIntensity={glow}
          transparent opacity={motion.o} depthWrite={motion.o.to((o) => o > 0.98)} toneMapped={false} />
      </RoundedBox>
      <AnimatedLabel text={head} position={[LEFT, 0.14, FRONT]} size={HEAD} anchorX="left" opacity={motion.o} />
      {ret && <AnimatedLabel text={ret} position={[-LEFT, 0.14, FRONT]} size={HEAD} anchorX="right" color={COLORS.done} opacity={motion.o} />}
      {localsLine(frame, cellsAt(SUB)).map((s) => (
        <AnimatedLabel key={s.at} text={s.text} position={[LEFT + s.at * 0.6 * SUB, -0.16, FRONT]} size={SUB} anchorX="left"
          color={s.changed ? COLORS.changed : COLORS.inkDim} opacity={motion.o} />
      ))}
    </animated.group>
  );
}

/** A frame on the stack: drops in when called (fades in place when it shows up otherwise), then follows its slot. */
function StackFrame({ frame, stepKey, timing }: { frame: FrameModel; stepKey: string; timing: AnimTiming }) {
  const y = slotY(frame.slot);
  const [from] = useState(() => ({ y: frame.isNew ? y + LIFT : y, z: 0, o: 0 }));
  const motion = useSpring({ from, to: { y, z: 0, o: 1 }, config: timing.config, immediate: timing.immediate });
  const glow = usePulse(`${stepKey}:${frame.callId}`, frame.isNew, LOOK[frame.state].glow);
  return <Slab frame={frame} motion={motion} glow={glow} timing={timing} />;
}

/** A frame leaving at this step: rises off the stack, drifting back, and fades out. */
function LeavingFrame({ frame, timing }: { frame: FrameModel; timing: AnimTiming }) {
  const y = slotY(frame.slot);
  const [from] = useState(() => ({ y, z: 0, o: 1 }));
  const motion = useSpring({ from, to: { y: y + LIFT, z: -0.3, o: 0 }, config: timing.config, immediate: timing.immediate });
  return <Slab frame={frame} motion={motion} glow={LOOK[frame.state].glow} timing={timing} />;
}

export function CallStackView({ view, detection }: VizProps<CallStackBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const model = useMemo(() => buildStackModel(view.tl, view.i, hl), [view, hl]);
  const stepKey = hl?.key ?? String(view.i);
  // sized for the deepest stack of the run, so the layout and the camera don't breathe with every call
  const rows = Math.min(MAX_FRAMES, Math.max(1, maxStackDepth(view.tl)));
  const titleY = rows * PITCH + 0.45;
  useReportSize({ w: SLAB[0] + 0.8, h: titleY + 0.45, d: 1.2 });
  const top = model.frames[model.frames.length - 1];
  useFocusPoint(detection.key, top ? [0, slotY(top.slot), 0] : null, 1, stepKey);
  const hidden = model.hiddenBelow;
  return (
    <group>
      <Label text={detection.title} position={[-SLAB[0] / 2, titleY, 0]} anchorX="left" size={0.3} color={COLORS.inkDim} />
      <mesh position={[0, -0.04, 0]}>
        <boxGeometry args={[SLAB[0] + 0.3, 0.06, SLAB[2] + 0.3]} />
        <meshStandardMaterial color={COLORS.surface} roughness={0.6} />
      </mesh>
      {!model.frames.length && <Label text="(empty)" position={[0, slotY(0), 0]} size={0.22} color={COLORS.inkFaint} />}
      {model.frames.map((f) => <StackFrame key={f.callId} frame={f} stepKey={stepKey} timing={timing} />)}
      {model.leaving.map((f) => <LeavingFrame key={`${f.callId}:${stepKey}`} frame={f} timing={timing} />)}
      {hidden > 0 && (
        <Label text={`… ${hidden} more frame${hidden === 1 ? '' : 's'}`} position={[0, -0.36, 0.3]} size={0.2} color={COLORS.inkFaint} />
      )}
    </group>
  );
}
