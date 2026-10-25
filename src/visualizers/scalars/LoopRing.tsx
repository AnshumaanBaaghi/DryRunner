/** Progress ring for an active loop: arc = iteration / total (total known once the loop finished in the trace). */
import { useSpring } from '@react-spring/three';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { TorusGeometry, type Mesh } from 'three';
import { useAnimTiming } from '../../scene/anim';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';

const ARC_STEPS = 96;
const arcCache = new Map<number, TorusGeometry>();

/** Arc geometries are shared and quantized, so animating the arc never allocates per frame. */
function arcGeometry(arc: number): TorusGeometry {
  const k = Math.max(1, Math.min(ARC_STEPS, Math.round((arc / (Math.PI * 2)) * ARC_STEPS)));
  let g = arcCache.get(k);
  if (!g) {
    g = new TorusGeometry(0.55, 0.075, 12, Math.max(4, Math.round(k * 0.7)), (k / ARC_STEPS) * Math.PI * 2);
    arcCache.set(k, g);
  }
  return g;
}

export function LoopRing({ x, y, iteration, total, label }: { x: number; y: number; iteration: number; total: number | null; label: string }) {
  const timing = useAnimTiming();
  const fraction = total ? Math.min(1, iteration / total) : Math.min(1, iteration / Math.max(iteration + 1, 4));
  const spring = useSpring({ arc: Math.max(0.0001, fraction * Math.PI * 2), config: timing.config, immediate: timing.immediate });
  const arcMesh = useRef<Mesh>(null);
  useFrame(() => {
    const m = arcMesh.current;
    if (!m) return;
    const g = arcGeometry(spring.arc.get());
    if (m.geometry !== g) m.geometry = g;
  });
  return (
    <group position={[x, y, 0]}>
      <mesh>
        <torusGeometry args={[0.55, 0.05, 12, 64]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* arc grows clockwise from 12 o'clock */}
      <mesh ref={arcMesh} rotation-z={Math.PI / 2} scale={[-1, 1, 1]} geometry={arcGeometry(spring.arc.get())} dispose={null}>
        <meshStandardMaterial color={COLORS.window} emissive={COLORS.window} emissiveIntensity={1.2} toneMapped={false} />
      </mesh>
      <Label text={total ? `${iteration}/${total}` : `#${iteration}`} position={[0, 0, 0.05]} size={0.26} color={COLORS.ink} />
      <Label text={label} position={[0, -0.85, 0]} size={0.18} color={COLORS.inkDim} />
    </group>
  );
}
