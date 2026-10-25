/** Memoized-recursion visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Timeline } from '../../engine/timeline/types';
import { previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import { buildCallTree } from '../shared/callTree';
import type { Detection, Visualizer } from '../types';
import { detectMemo, type MemoBindings } from './detect';
import { memoInfo, nodeTexts } from './model';

const MemoView = lazy(() => import('./MemoView').then((m) => ({ default: m.MemoView })));

/** HUD lines: a call answered from the cache, a call storing its result. */
function describe(tl: Timeline, i: number, d: Detection<MemoBindings>): string[] {
  if (i === 0) return [];
  const b = d.bindings;
  const tree = buildCallTree(tl, b.fnIds);
  const info = memoInfo(tl, tree, b);
  const hitCall = info.hitAt.get(i);
  const storeCall = info.storeAt.get(i);
  if (hitCall === undefined && storeCall === undefined) return [];
  const { labels } = nodeTexts(tl, tree, info);
  const fmt = (v: V) => previewValue(tl, tl.snapshots[i], v, { depth: 1, maxItems: 6, maxString: 12 });
  const out: string[] = [];
  if (hitCall !== undefined) {
    const hit = info.calls.get(hitCall)?.hit;
    if (hit) out.push(`cache hit: ${labels.get(hitCall)} = ${fmt(hit.value)}`);
  }
  if (storeCall !== undefined) {
    const stored = info.calls.get(storeCall)?.stored;
    if (stored) out.push(`stored ${labels.get(storeCall)} = ${fmt(stored.value)} in ${b.cache.name}`);
  }
  return out;
}

export const memoVisualizer: Visualizer<MemoBindings> = {
  id: 'memo',
  label: 'Memoized recursion',
  detect: detectMemo,
  Component: MemoView,
  describe,
  // an upright tree, like the recursion tree
  cameraTilt: 0.16,
};
