import { compileAndRun } from '../../src/engine/compileAndRun';
import { buildTimeline } from '../../src/engine/timeline/builder';
import { frameById, visibleVars } from '../../src/engine/timeline/scope';
import type { Timeline } from '../../src/engine/timeline/types';
import { materialize, previewValue } from '../../src/engine/timeline/values';
import type { RunLimits } from '../../src/engine/types/trace';

export async function timelineOf(source: string, limits: Partial<RunLimits> = {}): Promise<Timeline> {
  const r = await compileAndRun(source, limits);
  if (!r.ok) throw new Error(`compile error: ${r.error.message}`);
  return buildTimeline(r.meta, r.events);
}

/** Visible variables of the step's frame as `name → preview`. */
export function varsAt(tl: Timeline, step: number, callId?: number): Record<string, string> {
  const snap = tl.snapshots[step];
  const frame = frameById(snap, callId ?? tl.steps[step].callId);
  const out: Record<string, string> = {};
  if (!frame) return out;
  for (const v of visibleVars(tl, frame)) out[v.name] = previewValue(tl, snap, v.slot.v, { depth: 3, maxItems: 50 });
  return out;
}

/** Materialized value of a visible variable (searching the stack top-down). */
export function valueOf(tl: Timeline, step: number, name: string): unknown {
  const snap = tl.snapshots[step];
  for (let i = snap.frames.size - 1; i >= 0; i--) {
    const frame = snap.frames.get(i);
    if (!frame) continue;
    const v = visibleVars(tl, frame).find((x) => x.name === name);
    if (v) return materialize(tl, snap, v.slot.v);
  }
  return undefined;
}

export const lastStep = (tl: Timeline) => tl.steps.length - 1;
