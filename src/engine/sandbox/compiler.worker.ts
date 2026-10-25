/** Persistent worker: holds Babel and instruments code. Never executes user code. */
import { instrument } from '../instrument';
import { isCompilerRequest, type CompilerResponse } from './protocol';

interface WorkerScope {
  postMessage(message: CompilerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const req = event.data;
  if (!isCompilerRequest(req)) return;
  let result;
  try {
    result = instrument(req.source);
  } catch (err) {
    result = { ok: false as const, error: { message: `Internal instrumenter error: ${(err as Error).message}`, line: 1, col: 0 } };
  }
  if (req.kind === 'compile') {
    scope.postMessage(result.ok
      ? { kind: 'compiled', id: req.id, ok: true, code: result.code, meta: result.meta }
      : { kind: 'compiled', id: req.id, ok: false, error: result.error });
  } else {
    scope.postMessage(result.ok
      ? { kind: 'analyzed', id: req.id, ok: true, analysis: result.meta.analysis }
      : { kind: 'analyzed', id: req.id, ok: false, error: result.error });
  }
});
