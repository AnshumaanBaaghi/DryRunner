/**
 * Development-only measurements (loaded on demand from the dev hook, never part of a production build):
 * how long a whole trace takes to fold into a timeline, and the worst time to have any step ready to show.
 */
import { describeStep, loopStatus } from './engine/describe/narrate';
import { sandbox } from './engine/sandbox/instance';
import { buildTimeline } from './engine/timeline/builder';
import { topFrame, visibleVars } from './engine/timeline/scope';
import { DEFAULT_LIMITS, type TraceEvent } from './engine/types/trace';

export interface BenchResult {
  steps: number;
  /** ms to build the timeline from the recorded events (median of 3) */
  build: number;
  /** worst ms to read a random step: snapshot, narration, loop status, visible variables */
  access: number;
}

export async function bench(source: string): Promise<BenchResult> {
  const compiled = await sandbox().compile(source);
  if (!compiled.ok) throw new Error(compiled.error.message);
  const events: TraceEvent[] = [];
  await sandbox().run(compiled.code, { ...DEFAULT_LIMITS, timeoutMs: 10_000 }, (batch) => {
    for (const e of batch) events.push(e);
  }).done;
  const builds: number[] = [];
  let tl = buildTimeline(compiled.meta, events);
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    tl = buildTimeline(compiled.meta, events);
    builds.push(performance.now() - t0);
  }
  let access = 0;
  for (let k = 0; k < 300; k++) {
    const i = Math.floor(Math.random() * tl.steps.length);
    const t0 = performance.now();
    describeStep(tl, i);
    loopStatus(tl, i);
    visibleVars(tl, topFrame(tl.snapshots[i]));
    access = Math.max(access, performance.now() - t0);
  }
  return { steps: tl.steps.length, build: builds.sort((a, b) => a - b)[1], access };
}
