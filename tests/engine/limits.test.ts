import { describe, expect, it } from 'vitest';
import { trace } from '../helpers/trace';

describe('limits never freeze and keep a playable partial trace', () => {
  it('stops an infinite while loop at maxSteps', async () => {
    const t = await trace('let i = 0; while (true) { i++; }', { maxSteps: 500 });
    expect(t.status).toBe('limit-steps');
    expect(t.steps).toHaveLength(501); // 500 steps + end
    expect(t.steps[500]).toMatchObject({ t: 'end', status: 'limit-steps' });
  });

  it('stops for(;;) through the synthetic test hook', async () => {
    const t = await trace('let n = 0; for (;;) { n += 1; }', { maxSteps: 300 });
    expect(t.status).toBe('limit-steps');
  });

  it('cannot be swallowed by user try/catch', async () => {
    const t = await trace(`for (;;) { try { JSON.parse('{'); } catch {} }`, { maxSteps: 200 });
    expect(t.status).toBe('limit-steps');
    const t2 = await trace(`function f() { try { while (true) {} } catch (e) { return 'swallowed'; } } console.log(f()); console.log('after');`, { maxSteps: 200 });
    expect(t2.status).toBe('limit-steps');
    expect(t2.logs).toEqual([]);
  });

  it('stops runaway recursion at maxDepth', async () => {
    const t = await trace('function down(n) { return down(n + 1); } down(0);', { maxDepth: 120 });
    expect(t.status).toBe('limit-depth');
    const calls = t.steps.filter((s) => s.t === 'call');
    expect(calls).toHaveLength(120);
  });

  it('stops long-running code at the timeout', async () => {
    const t = await trace(`let x = 0; while (true) { const a = new Array(5000).fill(1); x += a.length; }`, {
      maxSteps: 10_000_000, timeoutMs: 150,
    });
    expect(t.status).toBe('timeout');
    expect(t.steps.at(-1)).toMatchObject({ t: 'end', status: 'timeout' });
  });

  it('reports uncaught errors at the failing statement and keeps prior steps', async () => {
    const t = await trace(`let a = 1;
function f(o) {
  return o.missing.x;
}
f({});`);
    expect(t.status).toBe('error');
    const err = t.steps.find((s) => s.t === 'error');
    expect(err).toBeDefined();
    if (err?.t === 'error') {
      expect(err.message).toMatch(/missing|undefined/);
      expect(t.meta.stmts[err.sid].loc.line).toBe(3);
    }
    expect(t.steps.at(-1)).toMatchObject({ t: 'end', status: 'error' });
  });
});
