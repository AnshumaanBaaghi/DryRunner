/** 20k-step traces must fold quickly and allow instant random access (budget checked in WebKit too, Phase 8). */
import { describe, expect, it } from 'vitest';
import { compileAndRun } from '../../src/engine/compileAndRun';
import { buildTimeline } from '../../src/engine/timeline/builder';
import { describeStep } from '../../src/engine/describe/narrate';
import { traceColumns, traceRow } from '../../src/engine/describe/traceRows';

const CASES: Record<string, string> = {
  scalarLoop: 'let s = 0; for (let i = 0; i < 1e9; i++) { s += i; }',
  arrayWrites: 'const a = new Array(500).fill(0); for (let k = 0; ; k++) { a[k % 500] = a[(k + 1) % 500] + 1; }',
  deepCalls: 'function f(n) { return n === 0 ? 0 : 1 + f(n - 1); } for (;;) f(200);',
  grid: 'const g = Array.from({ length: 60 }, () => new Array(60).fill(0)); for (let k = 0; ; k++) { const i = k % 60, j = (k * 7) % 60; g[i][j] = (i && j) ? g[i - 1][j] + g[i][j - 1] : 1; }',
};

describe('performance at the 20k step limit', () => {
  for (const [name, src] of Object.entries(CASES)) {
    it(name, async () => {
      const r = await compileAndRun(src, { maxSteps: 20_000, timeoutMs: 10_000 });
      if (!r.ok) throw new Error(r.error.message);
      expect(r.summary.status).toBe('limit-steps');
      const t0 = performance.now();
      const tl = buildTimeline(r.meta, r.events);
      const build = performance.now() - t0;
      expect(tl.steps.length).toBe(20_002);
      // random access in both directions
      const t1 = performance.now();
      let probe = 0;
      for (let k = 0; k < 2_000; k++) {
        const i = (k * 7919) % tl.steps.length;
        probe += tl.snapshots[i].frames.size;
      }
      const access = (performance.now() - t1) / 2_000;
      const t2 = performance.now();
      const cols = traceColumns(tl);
      for (let k = 0; k < 40; k++) traceRow(tl, (k * 499) % tl.steps.length, cols);
      for (let k = 0; k < 40; k++) describeStep(tl, (k * 487) % tl.steps.length);
      const render = (performance.now() - t2) / 80;
      console.log(`${name}: events=${r.events.length} build=${build.toFixed(0)}ms access=${(access * 1000).toFixed(1)}µs row/desc=${render.toFixed(2)}ms`);
      expect(probe).toBeGreaterThan(0);
      expect(build).toBeLessThan(2_000);
      expect(access).toBeLessThan(1);
      expect(render).toBeLessThan(25);
    });
  }
});
