/**
 * Main-thread side of the sandbox: a persistent compiler worker plus one single-use runner worker per run
 * (a warm spare is kept ready). The in-worker deadline is the primary stop; the kill timer here is only a
 * backstop, started once the runner reports `started`.
 */
import type { RunSummary } from '../runtime/run';
import type { CompileError, ProgramMeta, StaticAnalysis } from '../types/meta';
import type { EndStatus, RunLimits, TraceEvent } from '../types/trace';
import { isCompilerResponse, isRunnerMessage, type CompilerRequest, type CompilerResponse } from './protocol';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void;
}

export interface WorkerFactories {
  compiler(): WorkerLike;
  runner(): WorkerLike;
  channel?(): { port1: PortLike; port2: Transferable };
}

export interface PortLike {
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export type CompileResult = { ok: true; code: string; meta: ProgramMeta } | { ok: false; error: CompileError };
export type AnalyzeResult = { ok: true; analysis: StaticAnalysis } | { ok: false; error: CompileError };

export interface RunHandle {
  done: Promise<RunSummary>;
  cancel(): void;
}

export const KILL_GRACE_MS = 500;
export const START_TIMEOUT_MS = 15_000;

export function browserFactories(): WorkerFactories {
  return {
    compiler: () => new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module', name: 'algoscope-compiler' }),
    runner: () => new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module', name: 'algoscope-runner' }),
  };
}

export class SandboxClient {
  private readonly factories: WorkerFactories;
  private compiler: WorkerLike | null = null;
  private spare: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (r: CompilerResponse) => void>();
  private disposed = false;

  constructor(factories: WorkerFactories) {
    this.factories = factories;
  }

  private compilerWorker(): WorkerLike {
    if (this.compiler) return this.compiler;
    const w = this.factories.compiler();
    w.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data;
      if (!isCompilerResponse(data)) return;
      const resolve = this.pending.get(data.id);
      this.pending.delete(data.id);
      resolve?.(data);
    });
    w.addEventListener('error', () => {
      // a crashed compiler is replaced on the next request; fail everything in flight
      for (const [id, resolve] of this.pending) {
        resolve({ kind: 'compiled', id, ok: false, error: { message: 'The compiler worker crashed. Try again.', line: 1, col: 0 } });
      }
      this.pending.clear();
      this.compiler = null;
    });
    this.compiler = w;
    return w;
  }

  private request(req: Omit<CompilerRequest, 'id'>): Promise<CompilerResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.compilerWorker().postMessage({ ...req, id });
    });
  }

  async compile(source: string): Promise<CompileResult> {
    const r = await this.request({ kind: 'compile', source });
    if (r.kind !== 'compiled') return { ok: false, error: { message: 'Unexpected compiler reply', line: 1, col: 0 } };
    return r.ok ? { ok: true, code: r.code, meta: r.meta } : { ok: false, error: r.error };
  }

  async analyze(source: string): Promise<AnalyzeResult> {
    const r = await this.request({ kind: 'analyze', source });
    if (r.kind !== 'analyzed') return { ok: false, error: { message: 'Unexpected compiler reply', line: 1, col: 0 } };
    return r.ok ? { ok: true, analysis: r.analysis } : { ok: false, error: r.error };
  }

  /** Pre-spawn the next runner so a run starts instantly. */
  warmUp(): void {
    if (!this.spare && !this.disposed) this.spare = this.factories.runner();
    this.compilerWorker();
  }

  private takeRunner(): WorkerLike {
    const w = this.spare ?? this.factories.runner();
    this.spare = null;
    return w;
  }

  run(code: string, limits: RunLimits, onEvents: (events: TraceEvent[]) => void): RunHandle {
    const worker = this.takeRunner();
    const channel = this.factories.channel?.() ?? new MessageChannel();
    const port = channel.port1 as PortLike;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveDone!: (s: RunSummary) => void;
    const done = new Promise<RunSummary>((resolve) => {
      resolveDone = resolve;
    });

    const finish = (summary: RunSummary, synthesize: EndStatus | null) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (synthesize) onEvents([{ t: 'end', status: synthesize, ...(summary.error ? { error: summary.error } : {}) }]);
      worker.terminate();
      port.onmessage = null;
      try {
        port.close();
      } catch {
        // already closed
      }
      resolveDone(summary);
      this.warmUp();
    };

    // never started (worker failed to load): give up after a generous delay
    killTimer = setTimeout(() => finish({ status: 'error', steps: 0, error: { name: 'Error', message: 'The runner did not start.' } }, 'error'), START_TIMEOUT_MS);

    port.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (settled || !isRunnerMessage(msg)) return;
      switch (msg.kind) {
        case 'started':
          if (killTimer) clearTimeout(killTimer);
          killTimer = setTimeout(() => finish({ status: 'timeout', steps: 0 }, 'timeout'), limits.timeoutMs + KILL_GRACE_MS);
          break;
        case 'events':
          onEvents(msg.events);
          break;
        case 'done':
          finish(msg.summary, null);
          break;
        case 'crash':
          finish({ status: 'error', steps: 0, error: { name: 'InternalError', message: msg.message } }, 'error');
          break;
      }
    };
    worker.addEventListener('error', (event) => {
      const message = (event as ErrorEvent).message || 'The runner crashed.';
      finish({ status: 'error', steps: 0, error: { name: 'Error', message } }, 'error');
    });
    worker.postMessage({ kind: 'run', code, limits }, [channel.port2]);

    return {
      done,
      cancel: () => finish({ status: 'error', steps: 0, error: { name: 'Cancelled', message: 'Run cancelled.' } }, 'error'),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.compiler?.terminate();
    this.spare?.terminate();
    this.compiler = null;
    this.spare = null;
  }
}
