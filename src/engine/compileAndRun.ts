/** Instrument + run in one call (Node tests, scripts). The browser splits these across two workers. */
import { instrument } from './instrument';
import { runInstrumented, type RunSummary } from './runtime/run';
import type { CompileError, ProgramMeta } from './types/meta';
import { DEFAULT_LIMITS, type RunLimits, type TraceEvent } from './types/trace';

export type CompileAndRunResult =
  | { ok: true; meta: ProgramMeta; events: TraceEvent[]; summary: RunSummary }
  | { ok: false; error: CompileError };

export async function compileAndRun(source: string, limits: Partial<RunLimits> = {}): Promise<CompileAndRunResult> {
  const compiled = instrument(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  const events: TraceEvent[] = [];
  const summary = await runInstrumented(compiled.code, { ...DEFAULT_LIMITS, ...limits }, (batch) => {
    for (const ev of batch) events.push(ev);
  });
  return { ok: true, meta: compiled.meta, events, summary };
}
