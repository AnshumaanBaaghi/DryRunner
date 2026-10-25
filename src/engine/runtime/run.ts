/** Executes instrumented code against a fresh Tracer. Shared by the runner worker and Node tests. */
import { TRACER } from '../instrument/names';
import type { EndStatus, RunLimits, TraceEvent } from '../types/trace';
import { realStructuredClone } from './primordials';
import { seededMath } from './random';
import { ABORT, errorInfo, Tracer } from './tracer';

export interface RunSummary {
  status: EndStatus;
  steps: number;
  error?: { name: string; message: string };
}

/** Globals hidden from user code (passed as parameters, so they shadow the worker scope). */
const SHADOWED = [
  'console', 'Math', 'structuredClone', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate',
  'queueMicrotask', 'requestAnimationFrame', 'self', 'globalThis', 'window', 'postMessage', 'importScripts', 'fetch',
  'XMLHttpRequest', 'WebSocket', 'close', 'onmessage',
] as const;

const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame']);

function shadowValue(name: (typeof SHADOWED)[number], tracer: Tracer, limits: RunLimits): unknown {
  if (name === 'console') return tracer.console;
  if (name === 'Math') return seededMath(limits.seed);
  if (name === 'structuredClone') {
    return (value: unknown, options?: StructuredSerializeOptions) => {
      if (!realStructuredClone) throw new Error('structuredClone is not available');
      return (realStructuredClone as (v: unknown, o?: StructuredSerializeOptions) => unknown)(tracer.membrane.unwrap(value), options);
    };
  }
  if (TIMERS.has(name)) {
    return () => {
      throw new Error(`${name} is not supported — AlgoScope traces synchronous code.`);
    };
  }
  if (name === 'clearTimeout' || name === 'clearInterval') return () => undefined;
  return undefined;
}

export async function runInstrumented(code: string, limits: RunLimits, sink: (events: TraceEvent[]) => void): Promise<RunSummary> {
  const tracer = new Tracer(limits, sink);
  let program: (...args: unknown[]) => unknown;
  try {
    program = new Function(TRACER, ...SHADOWED, code) as (...args: unknown[]) => unknown;
  } catch (err) {
    const error = { name: 'InternalError', message: `Instrumented code failed to compile: ${errorInfo(err).message}` };
    tracer.finish('error', error);
    return { status: 'error', steps: 0, error };
  }
  let status: EndStatus = 'ok';
  let error: RunSummary['error'];
  try {
    program.call({}, tracer, ...SHADOWED.map((name) => shadowValue(name, tracer, limits)));
  } catch (err) {
    if (err === ABORT) {
      status = tracer.status;
    } else {
      tracer.uncaught(err);
      status = tracer.aborted ? tracer.status : 'error';
      error = errorInfo(err);
    }
  }
  // Promise callbacks run as microtasks: give them a chance while still recording.
  for (let i = 0; i < 4 && !tracer.aborted; i++) await Promise.resolve();
  if (tracer.aborted) status = tracer.status;
  tracer.finish(status, status === 'error' ? error : undefined);
  return { status, steps: tracer.stepCount, error };
}
