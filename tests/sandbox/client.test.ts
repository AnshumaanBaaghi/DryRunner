/** SandboxClient with mocked workers (London-school): protocol, streaming, backstop kill and crash paths. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KILL_GRACE_MS, SandboxClient, type PortLike, type WorkerFactories, type WorkerLike } from '../../src/engine/sandbox/client';
import { DEFAULT_LIMITS, type TraceEvent } from '../../src/engine/types/trace';

class MockWorker implements WorkerLike {
  posted: { msg: unknown; transfer?: Transferable[] }[] = [];
  terminated = false;
  private listeners: Record<string, ((e: MessageEvent | ErrorEvent) => void)[]> = { message: [], error: [] };
  postMessage(msg: unknown, transfer?: Transferable[]) {
    this.posted.push({ msg, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  addEventListener(type: 'message' | 'error', listener: (e: MessageEvent | ErrorEvent) => void) {
    this.listeners[type].push(listener);
  }
  emit(type: 'message' | 'error', payload: unknown) {
    for (const l of this.listeners[type]) l((type === 'message' ? { data: payload } : payload) as MessageEvent);
  }
}

class MockPort implements PortLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  deliver(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function setup() {
  const compilers: MockWorker[] = [];
  const runners: MockWorker[] = [];
  const ports: MockPort[] = [];
  const factories: WorkerFactories = {
    compiler: () => {
      const w = new MockWorker();
      compilers.push(w);
      return w;
    },
    runner: () => {
      const w = new MockWorker();
      runners.push(w);
      return w;
    },
    channel: () => {
      const port1 = new MockPort();
      ports.push(port1);
      return { port1, port2: {} as Transferable };
    },
  };
  return { client: new SandboxClient(factories), compilers, runners, ports };
}

const END: TraceEvent = { t: 'end', status: 'ok' };

describe('SandboxClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('compiles through the persistent compiler worker', async () => {
    const { client, compilers } = setup();
    const p = client.compile('let x = 1;');
    const req = compilers[0].posted[0].msg as { kind: string; id: number; source: string };
    expect(req).toMatchObject({ kind: 'compile', source: 'let x = 1;' });
    compilers[0].emit('message', { kind: 'compiled', id: req.id, ok: false, error: { message: 'boom', line: 1, col: 0 } });
    await expect(p).resolves.toEqual({ ok: false, error: { message: 'boom', line: 1, col: 0 } });
    client.compile('again');
    expect(compilers).toHaveLength(1); // reused
  });

  it('streams events, resolves on done, terminates the runner and keeps a warm spare', async () => {
    const { client, runners, ports } = setup();
    const received: TraceEvent[] = [];
    const handle = client.run('code', DEFAULT_LIMITS, (evs) => received.push(...evs));
    expect(runners[0].posted[0].msg).toMatchObject({ kind: 'run', code: 'code' });
    expect(runners[0].posted[0].transfer).toHaveLength(1);
    ports[0].deliver({ kind: 'started' });
    ports[0].deliver({ kind: 'events', events: [{ t: 'stmt', sid: 0, callId: 0, inst: 1 }, END] });
    ports[0].deliver({ kind: 'done', summary: { status: 'ok', steps: 1 } });
    await expect(handle.done).resolves.toEqual({ status: 'ok', steps: 1 });
    expect(received).toHaveLength(2);
    expect(runners[0].terminated).toBe(true);
    expect(runners).toHaveLength(2); // spare pre-spawned for the next run
  });

  it('kills a runner that outlives its deadline and synthesizes end{timeout}, keeping streamed events', async () => {
    const { client, runners, ports } = setup();
    const received: TraceEvent[] = [];
    const handle = client.run('code', { ...DEFAULT_LIMITS, timeoutMs: 1000 }, (evs) => received.push(...evs));
    ports[0].deliver({ kind: 'started' });
    ports[0].deliver({ kind: 'events', events: [{ t: 'stmt', sid: 0, callId: 0, inst: 1 }] });
    vi.advanceTimersByTime(1000 + KILL_GRACE_MS - 1);
    expect(runners[0].terminated).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(handle.done).resolves.toMatchObject({ status: 'timeout' });
    expect(runners[0].terminated).toBe(true);
    expect(received.at(-1)).toEqual({ t: 'end', status: 'timeout' });
    expect(received).toHaveLength(2);
  });

  it('reports runner crashes as an error end', async () => {
    const { client, ports } = setup();
    const received: TraceEvent[] = [];
    const handle = client.run('code', DEFAULT_LIMITS, (evs) => received.push(...evs));
    ports[0].deliver({ kind: 'crash', message: 'bad' });
    await expect(handle.done).resolves.toMatchObject({ status: 'error' });
    expect(received.at(-1)).toMatchObject({ t: 'end', status: 'error' });
  });

  it('ignores malformed messages', async () => {
    const { client, ports } = setup();
    const received: TraceEvent[] = [];
    client.run('code', DEFAULT_LIMITS, (evs) => received.push(...evs));
    ports[0].deliver({ kind: 'events', events: 'nope' });
    ports[0].deliver('garbage');
    ports[0].deliver({ kind: 'mystery' });
    expect(received).toHaveLength(0);
  });

  it('cancel terminates immediately', async () => {
    const { client, runners } = setup();
    const handle = client.run('code', DEFAULT_LIMITS, () => undefined);
    handle.cancel();
    await expect(handle.done).resolves.toMatchObject({ status: 'error' });
    expect(runners[0].terminated).toBe(true);
  });
});
