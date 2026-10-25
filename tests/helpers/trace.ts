import { compileAndRun } from '../../src/engine/compileAndRun';
import { formatLogLine } from '../../src/engine/runtime/format';
import type { ProgramMeta } from '../../src/engine/types/meta';
import { isStepEvent, type RunLimits, type StepEvent, type TraceEvent } from '../../src/engine/types/trace';

export interface Traced {
  meta: ProgramMeta;
  events: TraceEvent[];
  steps: StepEvent[];
  logs: string[];
  status: string;
}

export async function trace(source: string, limits: Partial<RunLimits> = {}): Promise<Traced> {
  const r = await compileAndRun(source, limits);
  if (!r.ok) throw new Error(`compile error: ${r.error.message} (${r.error.line}:${r.error.col})`);
  const steps = r.events.filter(isStepEvent);
  const logs = r.events.filter((e) => e.t === 'log').map((e) => (e as { text: string }).text);
  return { meta: r.meta, events: r.events, steps, logs, status: r.summary.status };
}

/** Run plain JS natively with a console that formats like the traced one. */
export function runNative(source: string): string[] {
  const out: string[] = [];
  const consoleLike = { log: (...args: unknown[]) => out.push(formatLogLine(args, (x) => x)) };
  try {
    new Function('console', source)(consoleLike);
  } catch (err) {
    out.push(`THROW ${(err as Error).message}`);
  }
  return out;
}

export function tracedOutput(t: Traced, error?: string): string[] {
  return error ? [...t.logs, `THROW ${error}`] : t.logs;
}
