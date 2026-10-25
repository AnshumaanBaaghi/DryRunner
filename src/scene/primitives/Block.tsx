/** Rounded value block (array cells, stack/queue items, scalar cards) with animated color and pulse. */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { RoundedBox } from '@react-three/drei';
import type { ReactNode } from 'react';
import type { AnimTiming } from '../anim';
import { Label } from './Label';
import { COLORS, SURFACE } from './materials';

type Vec3 = [number, number, number];

export interface BlockProps {
  position: Vec3;
  size?: Vec3;
  color: string;
  emissive?: string;
  pulse?: SpringValue<number>;
  label?: string;
  labelColor?: string;
  labelSize?: number;
  opacity?: number;
  timing: AnimTiming;
  castShadow?: boolean;
  children?: ReactNode;
}

const AnimatedMaterial = animated('meshPhysicalMaterial');

export function Block({
  position, size = [0.9, 0.9, 0.9], color, emissive, pulse, label, labelColor = COLORS.ink, labelSize, opacity = 1, timing,
  castShadow = true, children,
}: BlockProps) {
  const spring = useSpring({
    pos: position, color, emissive: emissive ?? color, opacity,
    config: timing.config, immediate: timing.immediate,
  });
  const [w, h, d] = size;
  return (
    <animated.group position={spring.pos as unknown as Vec3}>
      <RoundedBox args={[w, h, d]} radius={Math.min(w, h, d) * 0.12} smoothness={3} castShadow={castShadow} receiveShadow>
        <AnimatedMaterial
          {...SURFACE}
          color={spring.color}
          emissive={spring.emissive}
          emissiveIntensity={pulse ?? 0.06}
          transparent={opacity < 1}
          opacity={spring.opacity}
          toneMapped={false}
        />
      </RoundedBox>
      {label !== undefined && (
        <Label text={label} position={[0, 0, d / 2 + 0.012]} size={labelSize ?? Math.min(w, h) * 0.36} color={labelColor} />
      )}
      {children}
    </animated.group>
  );
}
