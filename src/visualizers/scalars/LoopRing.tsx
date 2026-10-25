/** Progress ring for an active loop: arc = iteration / total (total known once the loop finished in the trace). */
import { animated, useSpring } from '@react-spring/three';
import { useAnimTiming } from '../../scene/anim';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';

export function LoopRing({ x, y, iteration, total, label }: { x: number; y: number; iteration: number; total: number | null; label: string }) {
  const timing = useAnimTiming();
  const fraction = total ? Math.min(1, iteration / total) : Math.min(1, iteration / Math.max(iteration + 1, 4));
  const spring = useSpring({ arc: Math.max(0.0001, fraction * Math.PI * 2), config: timing.config, immediate: timing.immediate });
  return (
    <group position={[x, y, 0]}>
      <mesh>
        <torusGeometry args={[0.55, 0.05, 12, 64]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <animated.mesh rotation-z={Math.PI / 2} scale={[-1, 1, 1]}>
        {/* arc grows clockwise from 12 o'clock */}
        <AnimatedTorus arc={spring.arc} />
        <meshStandardMaterial color={COLORS.window} emissive={COLORS.window} emissiveIntensity={1.2} toneMapped={false} />
      </animated.mesh>
      <Label text={total ? `${iteration}/${total}` : `#${iteration}`} position={[0, 0, 0.05]} size={0.26} color={COLORS.ink} />
      <Label text={label} position={[0, -0.85, 0]} size={0.18} color={COLORS.inkDim} />
    </group>
  );
}

const AnimatedTorus = animated(({ arc }: { arc: number }) => <torusGeometry args={[0.55, 0.075, 12, 64, arc]} />);
