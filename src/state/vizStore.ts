/**
 * What the 3D stage shows for the finished run — detections, the user's view overrides (main view,
 * hidden / extra views, variables bound to a chosen view, variables hidden from the variables view) —
 * plus stage preferences (quality, camera follow). Overrides survive re-running the same code.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { TraceAnalysis } from '../engine/detect/analysis';
import type { VarRef } from '../engine/detect/track';
import type { Timeline } from '../engine/timeline/types';
import { boundKey } from '../visualizers/bind';
import { visualizerById } from '../visualizers/registry';
import { detectAll, selectDetections, type ViewOverrides } from '../visualizers/select';
import type { Detection } from '../visualizers/types';
import { useRun } from './runStore';
import type { StepView } from './selectors';
import { loadJSON, saveJSON } from './storage';

export type Quality = 'high' | 'low';

/** A variable the user asked to see with a given view. */
export interface Binding {
  vizId: string;
  ref: VarRef;
}

export interface Overrides extends Omit<ViewOverrides, 'bound'> {
  binds: Binding[];
}

const NONE: Overrides = { primary: null, hidden: [], shown: [], binds: [] };

interface VizState {
  /** timeline the detections belong to */
  timeline: Timeline | null;
  analysis: TraceAnalysis | null;
  /** program text the overrides belong to */
  source: string | null;
  /** every candidate, best first */
  candidates: Detection[];
  /** views created from the user's bindings */
  bound: Detection[];
  /** rendered on the stage, roles assigned */
  active: Detection[];
  overrides: Overrides;
  /** variable names left out of the variables view */
  hiddenVars: string[];
  quality: Quality;
  follow: boolean;
  /** bumps when the user asks to re-frame the camera */
  viewNonce: number;
  /** px the HUD covers at the top of the stage (largest seen) — the camera frames the scene below it */
  hudInset: number;
  setQuality(q: Quality): void;
  setHudInset(px: number): void;
  setFollow(on: boolean): void;
  resetView(): void;
  /** make a view the main one (null: automatic) */
  setPrimary(key: string | null): void;
  setShown(key: string, shown: boolean): void;
  /** show a variable with a view (it becomes the main view); false when the view can't draw it */
  bindVariable(vizId: string, ref: VarRef): boolean;
  resetOverrides(): void;
  toggleVar(name: string): void;
}

const saved = loadJSON<{ quality?: Quality; follow?: boolean }>('algoscope.stage', {});

function boundFor(tl: Timeline, analysis: TraceAnalysis, binds: Binding[]): Detection[] {
  const ctx = { tl, analysis };
  return binds.flatMap((b) => {
    try {
      const d = visualizerById(b.vizId)?.bindTo?.(ctx, b.ref);
      return d ? [d] : [];
    } catch {
      return [];
    }
  });
}

function arranged(s: Pick<VizState, 'timeline' | 'analysis' | 'candidates' | 'overrides'>): Pick<VizState, 'bound' | 'active'> {
  if (!s.timeline || !s.analysis) return { bound: [], active: [] };
  const bound = boundFor(s.timeline, s.analysis, s.overrides.binds);
  return { bound, active: selectDetections(s.candidates, { ...s.overrides, bound }) };
}

type RunPart = Pick<VizState, 'timeline' | 'analysis' | 'source' | 'candidates' | 'bound' | 'active' | 'overrides' | 'hiddenVars'>;

function forRun(tl: Timeline | null, status: string, source: string | null, prev: Pick<VizState, 'source' | 'overrides' | 'hiddenVars'>): RunPart {
  const keep = source !== null && source === prev.source;
  const overrides = keep ? prev.overrides : NONE;
  const hiddenVars = keep ? prev.hiddenVars : [];
  if (!tl || status !== 'done') return { timeline: tl, analysis: null, source, candidates: [], bound: [], active: [], overrides, hiddenVars };
  const { all, errors, analysis } = detectAll(tl);
  for (const e of errors) console.warn(`[algoscope] ${e.vizId} detector failed: ${e.message}`);
  const base = { timeline: tl, analysis, source, candidates: all, overrides };
  return { ...base, ...arranged(base), hiddenVars };
}

const initial = useRun.getState();

export const useViz = create<VizState>((set, get) => {
  const update = (overrides: Overrides) => set({ overrides, ...arranged({ ...get(), overrides }) });
  return {
    ...forRun(initial.timeline, initial.status, initial.ranSource, { source: null, overrides: NONE, hiddenVars: [] }),
    quality: saved.quality === 'low' ? 'low' : 'high',
    follow: saved.follow ?? true,
    viewNonce: 0,
    hudInset: 0,
    setQuality: (quality) => set({ quality }),
    setHudInset(px) {
      if (px > get().hudInset + 4) set({ hudInset: px });
    },
    setFollow: (follow) => set({ follow }),
    resetView: () => set({ viewNonce: get().viewNonce + 1 }),
    setPrimary(key) {
      const o = get().overrides;
      update({ ...o, primary: key, hidden: key ? o.hidden.filter((k) => k !== key) : o.hidden });
    },
    setShown(key, shown) {
      const o = get().overrides;
      if (shown) {
        update({ ...o, hidden: o.hidden.filter((k) => k !== key), shown: o.shown.includes(key) ? o.shown : [...o.shown, key] });
        return;
      }
      update({
        ...o,
        primary: o.primary === key ? null : o.primary,
        hidden: o.hidden.includes(key) ? o.hidden : [...o.hidden, key],
        shown: o.shown.filter((k) => k !== key),
        // hiding a view the user bound removes the binding
        binds: o.binds.filter((b) => boundKey(b.vizId, b.ref) !== key),
      });
    },
    bindVariable(vizId, ref) {
      const { timeline, analysis } = get();
      if (!timeline || !analysis || !boundFor(timeline, analysis, [{ vizId, ref }]).length) return false;
      const o = get().overrides;
      const key = boundKey(vizId, ref);
      const binds = [...o.binds.filter((b) => boundKey(b.vizId, b.ref) !== key), { vizId, ref }];
      update({ ...o, binds, primary: key, hidden: o.hidden.filter((k) => k !== key) });
      return true;
    },
    resetOverrides: () => update(NONE),
    toggleVar(name) {
      const hidden = get().hiddenVars;
      set({ hiddenVars: hidden.includes(name) ? hidden.filter((n) => n !== name) : [...hidden, name] });
    },
  };
});

useRun.subscribe((s, prev) => {
  if (s.timeline === prev.timeline && s.status === prev.status) return;
  useViz.setState(forRun(s.timeline, s.status, s.ranSource, useViz.getState()));
});

useViz.subscribe((s) => saveJSON('algoscope.stage', { quality: s.quality, follow: s.follow }));

/** Plugin HUD lines for the current step (e.g. "window expanded: right → 5"). */
export function useVizNotes(view: StepView | null): string[] {
  const active = useViz((s) => s.active);
  const timeline = useViz((s) => s.timeline);
  return useMemo(() => {
    if (!view || view.tl !== timeline) return [];
    const out: string[] = [];
    for (const d of active) {
      try {
        out.push(...(visualizerById(d.vizId)?.describe?.(view.tl, view.i, d) ?? []));
      } catch {
        // a plugin's annotation never breaks the HUD
      }
    }
    return out;
  }, [view, active, timeline]);
}
