/** Detections of the finished run (what the 3D stage shows) + stage preferences (quality, camera follow). */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { Timeline } from '../engine/timeline/types';
import { visualizerById } from '../visualizers/registry';
import { detectAll, selectDetections } from '../visualizers/select';
import type { Detection } from '../visualizers/types';
import { useRun } from './runStore';
import type { StepView } from './selectors';
import { loadJSON, saveJSON } from './storage';

export type Quality = 'high' | 'low';

interface VizState {
  /** timeline the detections belong to */
  timeline: Timeline | null;
  /** every candidate, best first */
  candidates: Detection[];
  /** rendered on the stage, roles assigned */
  active: Detection[];
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
}

const saved = loadJSON<{ quality?: Quality; follow?: boolean }>('algoscope.stage', {});

function detectionsFor(tl: Timeline | null, status: string): Pick<VizState, 'timeline' | 'candidates' | 'active'> {
  if (!tl || status !== 'done') return { timeline: tl, candidates: [], active: [] };
  const { all, errors } = detectAll(tl);
  for (const e of errors) console.warn(`[algoscope] ${e.vizId} detector failed: ${e.message}`);
  return { timeline: tl, candidates: all, active: selectDetections(all) };
}

export const useViz = create<VizState>((set, get) => ({
  ...detectionsFor(useRun.getState().timeline, useRun.getState().status),
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
}));

useRun.subscribe((s, prev) => {
  if (s.timeline === prev.timeline && s.status === prev.status) return;
  useViz.setState(detectionsFor(s.timeline, s.status));
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
