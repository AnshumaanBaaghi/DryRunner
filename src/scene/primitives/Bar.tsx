/** Vertical bar anchored at y = 0 (numeric arrays, sorting): animated x, height and color. */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import type { AnimTiming } from '../anim';
import { SURFACE } from './materials';

const AnimatedMaterial = animated('meshPhysicalMaterial');

export interface BarProps {
  x: number;
  z?: number;
  height: number;
  width?: number;
  depth?: number;
  color: string;
  pulse?: SpringValue<number>;
  /** lift for swap arcs: bars hop over each other when they trade places */
  hop?: number;
  timing: AnimTiming;
}

export function Bar({ x, z = 0, height, width = 0.78, depth = 0.78, color, pulse, hop = 0, timing }: BarProps) {
  const h = Math.max(0.04, Math.abs(height));
  const sign = height < 0 ? -1 : 1;
  const spring = useSpring({ x, h, y: (sign * h) / 2 + hop, color, config: timing.config, immediate: timing.immediate });
  return (
    <animated.mesh position-x={spring.x} position-y={spring.y} position-z={z} scale-y={spring.h} castShadow receiveShadow>
      <boxGeometry args={[width, 1, depth]} />
      <AnimatedMaterial {...SURFACE} color={spring.color} emissive={spring.color} emissiveIntensity={pulse ?? 0.06} toneMapped={false} />
    </animated.mesh>
  );
}
