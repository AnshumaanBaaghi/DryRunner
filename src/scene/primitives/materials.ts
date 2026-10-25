/** Shared look: physically based, slightly glossy surfaces; semantic colors from the theme. */
import { SEMANTIC } from '../../theme/colors';

export const COLORS = {
  ...SEMANTIC,
  idle: '#3d4b63',
  idleLight: '#64748b',
  surface: '#1b2535',
  ink: '#e2e8f0',
  inkDim: '#94a3b8',
  inkFaint: '#64748b',
  bg: '#0a0e15',
} as const;

export const SURFACE = {
  roughness: 0.45,
  metalness: 0.05,
  clearcoat: 0.3,
  clearcoatRoughness: 0.45,
} as const;

/** Emissive intensity that makes bloom pick an element up (bloom threshold is ~1). */
export const GLOW = 1.6;
