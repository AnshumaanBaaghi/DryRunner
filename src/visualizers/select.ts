/**
 * Detections → what the stage shows. Every plugin proposes detections; higher scores claim their
 * variables first (equal scores: the view explaining more structure wins) and a later detection needing
 * an already-claimed variable is dropped. The first structural detection is the primary (others move
 * beside it) and the scalars view fills in when nothing structural scored above it. User overrides can
 * pick the primary, hide or force views, and add views bound to a chosen variable.
 */
import { analyzeTrace, type TraceAnalysis } from '../engine/detect/analysis';
import type { Timeline } from '../engine/timeline/types';
import { visualizers } from './registry';
import type { AnyVisualizer, Detection } from './types';

export const MAX_ACTIVE = 4;
export const FALLBACK_ID = 'scalars';

/** Tie-break for equal scores, most specific first: the registry order never decides what is shown. */
export const SPECIFICITY = [
  'graph', 'gridGraph', 'tree', 'linkedList', 'memo', 'backtracking', 'dp2d', 'dp1d', 'recursionTree',
  'stack', 'queue', 'array', 'hashMap', 'callStack', 'scalars',
];

const rank = (vizId: string) => {
  const k = SPECIFICITY.indexOf(vizId);
  return k < 0 ? SPECIFICITY.length : k;
};

export interface DetectResult {
  /** every candidate, best first */
  all: Detection[];
  errors: { vizId: string; message: string }[];
  analysis: TraceAnalysis;
}

export function detectAll(tl: Timeline, plugins: readonly AnyVisualizer[] = visualizers()): DetectResult {
  const analysis = analyzeTrace(tl);
  const ctx = { tl, analysis };
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
  ranked.sort((a, b) => b.d.score - a.d.score || rank(a.d.vizId) - rank(b.d.vizId) || a.order - b.order);
  return { all: ranked.map((r) => r.d), errors, analysis };
}

export interface ViewOverrides {
  /** detection key shown as the main view */
  primary: string | null;
  /** detection keys the user hid */
  hidden: string[];
  /** detection keys the user asked to see, even when their variables are shown elsewhere */
  shown: string[];
  /** views the user created by showing a variable with a chosen visualizer */
  bound: Detection[];
}

export const NO_OVERRIDES: ViewOverrides = { primary: null, hidden: [], shown: [], bound: [] };

export function hasOverrides(o: ViewOverrides): boolean {
  return o.primary !== null || o.hidden.length > 0 || o.shown.length > 0 || o.bound.length > 0;
}

export function selectDetections(all: Detection[], o: ViewOverrides = NO_OVERRIDES): Detection[] {
  const fallback = all.find((d) => d.vizId === FALLBACK_ID);
  const forced = new Set([...o.shown, ...o.bound.map((d) => d.key), ...(o.primary ? [o.primary] : [])]);
  const pool = [...o.bound, ...all].filter((d) => !o.hidden.includes(d.key));
  // forced views first (the chosen primary leading), then the automatic ranking
  const ordered = [
    ...pool.filter((d) => d.key === o.primary),
    ...pool.filter((d) => forced.has(d.key) && d.key !== o.primary),
    ...pool.filter((d) => !forced.has(d.key)),
  ];
  const taken = new Set<string>();
  const chosen: Detection[] = [];
  for (const d of ordered) {
    const isForced = forced.has(d.key);
    if (!isForced && (d.vizId === FALLBACK_ID || (fallback && d.score < fallback.score))) continue;
    if (chosen.length >= MAX_ACTIVE) break;
    if (!isForced && d.claims.some((c) => taken.has(c))) continue;
    // a view the user asked for joins the others instead of pushing the ones sharing its variables out
    if (!isForced) for (const c of d.claims) taken.add(c);
    chosen.push(d);
  }
  let hasPrimary = false;
  const placed = chosen.map((d) => {
    const wantsPrimary = o.primary ? d.key === o.primary : d.role === 'primary';
    if (wantsPrimary && !hasPrimary) {
      hasPrimary = true;
      return d.role === 'primary' ? d : { ...d, role: 'primary' as const };
    }
    return d.role === 'primary' ? { ...d, role: 'secondary' as const } : d;
  });
  if (!hasPrimary && fallback && !o.hidden.includes(fallback.key) && !chosen.includes(fallback)) placed.unshift(fallback);
  return placed;
}
