/** Every built-in example runs to completion within the default limits and matches native output. */
import { describe, expect, it } from 'vitest';
import { compileAndRun } from '../../src/engine/compileAndRun';
import { buildTimeline } from '../../src/engine/timeline/builder';
import { EXAMPLES } from '../../src/examples';
import { runNative } from '../helpers/trace';

describe('built-in examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.category} · ${ex.title}`, async () => {
      const r = await compileAndRun(ex.code);
      if (!r.ok) throw new Error(`compile error: ${r.error.message}`);
      expect(r.summary.status).toBe('ok');
      const logs = r.events.filter((e) => e.t === 'log').map((e) => (e as { text: string }).text);
      expect(logs).toEqual(runNative(ex.code));
      const tl = buildTimeline(r.meta, r.events);
      expect(tl.status).toBe('ok');
      expect(tl.steps.length).toBeGreaterThan(5);
      expect(tl.steps.length).toBeLessThan(20_000);
    });
  }
});
