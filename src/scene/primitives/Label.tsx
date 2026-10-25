/** Single-font SDF text (troika via drei) with an optional billboard and dark outline for legibility. */
import { Billboard, Text } from '@react-three/drei';
import type { ReactNode } from 'react';
import { FONT_URL } from '../assets';
import { COLORS } from './materials';

type Vec3 = [number, number, number];

export interface LabelProps {
  text: string;
  position?: Vec3;
  size?: number;
  color?: string;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  billboard?: boolean;
  maxWidth?: number;
  outline?: boolean;
  opacity?: number;
  children?: ReactNode;
}

export function Label({
  text, position = [0, 0, 0], size = 0.28, color = COLORS.ink, anchorX = 'center', anchorY = 'middle', billboard = false,
  maxWidth, outline = true, opacity = 1,
}: LabelProps) {
  const t = (
    <Text
      font={FONT_URL}
      fontSize={size}
      color={color}
      anchorX={anchorX}
      anchorY={anchorY}
      maxWidth={maxWidth}
      outlineWidth={outline ? size * 0.07 : 0}
      outlineColor={COLORS.bg}
      fillOpacity={opacity}
      outlineOpacity={opacity}
      renderOrder={2}
    >
      {text}
    </Text>
  );
  return billboard ? <Billboard position={position}>{t}</Billboard> : <group position={position}>{t}</group>;
}
