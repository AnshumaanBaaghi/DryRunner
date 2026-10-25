/**
 * Single-use worker: runs one instrumented program and streams its trace over a private MessagePort.
 * The worker's own postMessage is never used for the protocol, so stray user calls can't interfere.
 */
import { runInstrumented } from '../runtime/run';
import { isRunnerStart, type RunnerMessage } from './protocol';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

const scope = globalThis as unknown as WorkerScope;
const closeWorker = scope.close.bind(scope);
let used = false;

scope.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (used || !port || !isRunnerStart(event.data)) return;
  used = true;
  const send = port.postMessage.bind(port) as (msg: RunnerMessage) => void;
  const { code, limits } = event.data;
  send({ kind: 'started' });
  runInstrumented(code, limits, (events) => send({ kind: 'events', events }))
    .then((summary) => send({ kind: 'done', summary }))
    .catch((err: unknown) => send({ kind: 'crash', message: (err as Error)?.message ?? String(err) }))
    .finally(() => closeWorker());
});
