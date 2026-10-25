/** Index pointers floating above elements, and the translucent window spanning a range. */
import { animated, useSpring } from '@react-spring/three';
import { Edges } from '@react-three/drei';
import type { AnimTiming } from '../anim';
import { Label } from './Label';
import { COLORS } from './materials';

const AnimatedBasic = animated('meshBasicMaterial');
const AnimatedStandard = animated('meshStandardMaterial');

export function PointerMarker({ x, y, label, color, stack = 0, timing }: {
  x: number;
  y: number;
  label: string;
  color: string;
  /** vertical slot when several pointers share an index */
  stack?: number;
  timing: AnimTiming;
}) {
  const lift = stack * 0.62;
  const spring = useSpring({ x, y: y + lift, color, config: timing.config, immediate: timing.immediate });
  return (
    <animated.group position-x={spring.x} position-y={spring.y}>
      <mesh position={[0, 0.16, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[0.17, 0.32, 20]} />
        <AnimatedStandard color={spring.color} emissive={spring.color} emissiveIntensity={1.4} toneMapped={false} roughness={0.3} />
      </mesh>
      <Label text={label} position={[0, 0.58, 0]} size={0.27} color={color} billboard />
    </animated.group>
  );
}

export function WindowBox({ from, to, spacing, height, color = COLORS.window, label, offset = 0, timing }: {
  /** inclusive index range */
  from: number;
  to: number;
  spacing: number;
  height: number;
  color?: string;
  label?: string;
  /** index offset so index 0 sits at x = offset * spacing (centered layouts) */
  offset?: number;
  timing: AnimTiming;
}) {
  const empty = to < from;
  const width = empty ? 0.0001 : (to - from + 1) * spacing;
  const center = (empty ? from + offset : (from + to) / 2 + offset) * spacing;
  const spring = useSpring({ x: center, w: width, opacity: empty ? 0 : 0.13, config: timing.config, immediate: timing.immediate });
  return (
    <animated.group position-x={spring.x} position-y={height / 2}>
      <animated.mesh scale-x={spring.w}>
        <boxGeometry args={[1, height, 1.15]} />
        <AnimatedBasic color={color} transparent opacity={spring.opacity} depthWrite={false} toneMapped={false} />
        <Edges color={color} threshold={10} />
      </animated.mesh>
      {label && !empty && <Label text={label} position={[0, -height / 2 - 0.72, 0.4]} size={0.22} color={color} />}
    </animated.group>
  );
}
