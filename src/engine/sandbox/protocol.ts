/** Typed, validated messages between the main thread and the two workers. */
import type { RunSummary } from '../runtime/run';
import type { CompileError, ProgramMeta, StaticAnalysis } from '../types/meta';
import type { RunLimits, TraceEvent } from '../types/trace';

// main ↔ compiler worker (persistent, holds Babel)
export type CompilerRequest =
  | { kind: 'compile'; id: number; source: string }
  | { kind: 'analyze'; id: number; source: string };

export type CompilerResponse =
  | { kind: 'compiled'; id: number; ok: true; code: string; meta: ProgramMeta }
  | { kind: 'compiled'; id: number; ok: false; error: CompileError }
  | { kind: 'analyzed'; id: number; ok: true; analysis: StaticAnalysis }
  | { kind: 'analyzed'; id: number; ok: false; error: CompileError };

// main → runner worker (single use; the MessagePort travels in `ports[0]`)
export interface RunnerStart {
  kind: 'run';
  code: string;
  limits: RunLimits;
}

// runner → main, over the private MessagePort
export type RunnerMessage =
  | { kind: 'started' }
  | { kind: 'events'; events: TraceEvent[] }
  | { kind: 'done'; summary: RunSummary }
  | { kind: 'crash'; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function isCompilerResponse(v: unknown): v is CompilerResponse {
  return isObject(v) && (v.kind === 'compiled' || v.kind === 'analyzed') && typeof v.id === 'number' && typeof v.ok === 'boolean';
}

export function isRunnerMessage(v: unknown): v is RunnerMessage {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'started':
      return true;
    case 'events':
      return Array.isArray(v.events);
    case 'done':
      return isObject(v.summary) && typeof v.summary.status === 'string';
    case 'crash':
      return typeof v.message === 'string';
    default:
      return false;
  }
}

export function isRunnerStart(v: unknown): v is RunnerStart {
  return isObject(v) && v.kind === 'run' && typeof v.code === 'string' && isObject(v.limits) &&
    typeof v.limits.maxSteps === 'number' && typeof v.limits.timeoutMs === 'number';
}

export function isCompilerRequest(v: unknown): v is CompilerRequest {
  return isObject(v) && (v.kind === 'compile' || v.kind === 'analyze') && typeof v.id === 'number' && typeof v.source === 'string';
}
