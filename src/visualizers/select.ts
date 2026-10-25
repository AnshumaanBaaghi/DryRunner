/**
 * Detections → what the stage shows. Every plugin proposes detections; higher scores claim their
 * variables first and a later detection needing an already-claimed variable is dropped. The first
 * structural detection is the primary (others move beside it) and the scalars view fills in when
 * nothing structural scored above it (weaker detections stay candidates only).
 */
import { analyzeTrace } from '../engine/detect/analysis';
import type { Timeline } from '../engine/timeline/types';
import { visualizers } from './registry';
import type { AnyVisualizer, Detection } from './types';

export const MAX_ACTIVE = 4;
export const FALLBACK_ID = 'scalars';

export interface DetectResult {
  /** every candidate, best first (ties keep registry order) */
  all: Detection[];
  errors: { vizId: string; message: string }[];
}

export function detectAll(tl: Timeline, plugins: readonly AnyVisualizer[] = visualizers()): DetectResult {
  const ctx = { tl, analysis: analyzeTrace(tl) };
  const ranked: { d: Detection; order: number }[] = [];
  const errors: DetectResult['errors'] = [];
  for (const plugin of plugins) {
    try {
      for (const d of plugin.detect(ctx)) ranked.push({ d, order: ranked.length });
    } catch (e) {
      // one faulty detector never hides the others
      errors.push({ vizId: plugin.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  ranked.sort((a, b) => b.d.score - a.d.score || a.order - b.order);
  return { all: ranked.map((r) => r.d), errors };
}

export function selectDetections(all: Detection[]): Detection[] {
  const fallback = all.find((d) => d.vizId === FALLBACK_ID);
  const taken = new Set<string>();
  const chosen: Detection[] = [];
  for (const d of all) {
    if (d.vizId === FALLBACK_ID || (fallback && d.score < fallback.score)) continue;
    if (chosen.length >= MAX_ACTIVE) break;
    if (d.claims.some((c) => taken.has(c))) continue;
    for (const c of d.claims) taken.add(c);
    chosen.push(d);
  }
  let hasPrimary = false;
  const placed = chosen.map((d) => {
    if (d.role !== 'primary') return d;
    if (!hasPrimary) {
      hasPrimary = true;
      return d;
    }
    return { ...d, role: 'secondary' as const };
  });
  if (!hasPrimary && fallback) placed.unshift(fallback);
  return placed;
}
