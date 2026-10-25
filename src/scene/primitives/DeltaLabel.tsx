/** Floating "old → new" tag that rises and fades after a change (keyed so each change replays). */
import { animated, useSpring } from '@react-spring/three';
import { Billboard, RoundedBox } from '@react-three/drei';
import { useEffect } from 'react';
import { Label } from './Label';
import { COLORS } from './materials';

type Vec3 = [number, number, number];

const AnimatedBasic = animated('meshBasicMaterial');

export function DeltaLabel({ position, text, changeKey, color = COLORS.changed }: {
  position: Vec3;
  text: string;
  changeKey: string;
  color?: string;
}) {
  const [spring, api] = useSpring(() => ({ y: 0, o: 0 }));
  useEffect(() => {
    api.start({ from: { y: -0.15, o: 1 }, to: [{ y: 0.15, o: 1, config: { duration: 900 } }, { o: 0, config: { duration: 700 } }] });
  }, [changeKey, api]);
  const width = Math.max(0.9, text.length * 0.17 + 0.3);
  return (
    <animated.group position={position} position-y={spring.y.to((y) => position[1] + y)}>
      <Billboard>
        <RoundedBox args={[width, 0.42, 0.02]} radius={0.08} smoothness={3} position={[0, 0, -0.02]}>
          <AnimatedBasic color={COLORS.bg} transparent opacity={spring.o.to((o) => o * 0.85)} depthWrite={false} />
        </RoundedBox>
        <animated.group scale={spring.o.to((o) => (o > 0.02 ? 1 : 0.0001))}>
          <Label text={text} size={0.25} color={color} outline={false} />
        </animated.group>
      </Billboard>
    </animated.group>
  );
}
