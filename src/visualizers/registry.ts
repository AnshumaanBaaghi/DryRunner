/** Every visualizer plugin. Adding one = a folder `src/visualizers/<id>/` exporting a `Visualizer` + one line here. */
import { arrayVisualizer } from './array';
import { backtrackingVisualizer } from './backtracking';
import { callStackVisualizer } from './callStack';
import { dp1dVisualizer } from './dp1d';
import { dp2dVisualizer } from './dp2d';
import { memoVisualizer } from './memo';
import { recursionTreeVisualizer } from './recursionTree';
import { scalarsVisualizer } from './scalars';
import type { AnyVisualizer } from './types';

const PLUGINS: AnyVisualizer[] = [
  arrayVisualizer,
  dp1dVisualizer,
  dp2dVisualizer,
  recursionTreeVisualizer,
  backtrackingVisualizer,
  memoVisualizer,
  callStackVisualizer,
  scalarsVisualizer,
];

export function visualizers(): readonly AnyVisualizer[] {
  return PLUGINS;
}

export function visualizerById(id: string): AnyVisualizer | undefined {
  return PLUGINS.find((p) => p.id === id);
}

/** Runtime registration (tests, extensions); returns the unregister function. */
export function registerVisualizer(plugin: AnyVisualizer): () => void {
  if (visualizerById(plugin.id)) throw new Error(`Visualizer "${plugin.id}" is already registered`);
  PLUGINS.push(plugin);
  return () => {
    const k = PLUGINS.indexOf(plugin);
    if (k >= 0) PLUGINS.splice(k, 1);
  };
}
