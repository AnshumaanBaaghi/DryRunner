/** Semantic colors shared by the 2D UI (CSS variables in index.css) and, later, the 3D scene. */
export const SEMANTIC = {
  current: '#F5A524', // amber — current element / step
  changed: '#FF7A1A', // orange — just changed (pulse)
  visited: '#3B82F6', // blue — visited / returned
  done: '#22C55E', // green — done / solution
  error: '#EF4444', // red — pruned / error
  window: '#22D3EE', // cyan — inside the window
  frontier: '#A78BFA', // violet — frontier
  neutral: '#64748B', // slate — idle elements
} as const;

export type SemanticColor = keyof typeof SEMANTIC;
