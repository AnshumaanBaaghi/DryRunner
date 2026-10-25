/** Glossy sphere for tree / graph nodes: animated position, color, glow and opacity; clickable. */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { useCursor } from '@react-three/drei';
import { useState, type ReactNode } from 'react';
import type { AnimTiming } from '../anim';
import { SURFACE } from './materials';

type Vec3 = [number, number, number];

const AnimatedMaterial = animated('meshPhysicalMaterial');

export interface NodeSphereProps {
  position: Vec3;
  radius?: number;
  color: string;
  /** resting emissive intensity (≥ 1 blooms) */
  glow?: number;
  /** replaces `glow` while a pulse plays */
  pulse?: SpringValue<number>;
  opacity?: number;
  timing: AnimTiming;
  onClick?(): void;
  /** drawn relative to the sphere center (labels, badges) */
  children?: ReactNode;
}

export function NodeSphere({ position, radius = 0.3, color, glow = 0.08, pulse, opacity = 1, timing, onClick, children }: NodeSphereProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && Boolean(onClick));
  const spring = useSpring({ pos: position, color, glow, opacity, config: timing.config, immediate: timing.immediate });
  return (
    <animated.group position={spring.pos as unknown as Vec3}>
      <mesh
        castShadow
        onClick={onClick ? (e) => {
          e.stopPropagation();
          onClick();
        } : undefined}
        onPointerOver={onClick ? (e) => {
          e.stopPropagation();
          setHovered(true);
        } : undefined}
        onPointerOut={onClick ? () => setHovered(false) : undefined}
      >
        <sphereGeometry args={[radius, 32, 24]} />
        <AnimatedMaterial
          {...SURFACE}
          color={spring.color}
          emissive={spring.color}
          emissiveIntensity={pulse ?? spring.glow}
          transparent={opacity < 1}
          opacity={spring.opacity}
          depthWrite={opacity >= 1}
          toneMapped={false}
        />
      </mesh>
      {children}
    </animated.group>
  );
}
