/** Acceptance: every bundled example is shown with its expected visualizers — no override needed. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../src/engine/detect/analysis';
import { bindingRef } from '../../src/engine/detect/analysis';
import { EXAMPLES, exampleById } from '../../src/examples';
import { visualizerById, visualizers } from '../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../src/visualizers/select';
import { timelineOf } from '../helpers/timeline';

const shuffle = <T,>(xs: readonly T[], seed: number): T[] => {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

describe('every example is detected without overrides', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id} → ${ex.expect.primary}${ex.expect.mode ? ` (${ex.expect.mode})` : ''}`, async () => {
      const tl = await timelineOf(ex.code);
      const active = selectDetections(detectAll(tl).all);
      const primary = active.find((d) => d.role === 'primary');
      expect(primary?.vizId).toBe(ex.expect.primary);
      if (ex.expect.mode) expect(primary?.mode).toBe(ex.expect.mode);
      for (const also of ex.expect.also ?? []) expect(active.map((d) => d.vizId)).toContain(also);
      // and the choice never depends on the order plugins were registered in
      for (const seed of [7, 42, 1234]) {
        const shuffled = selectDetections(detectAll(tl, shuffle(visualizers(), seed)).all);
        expect(shuffled.map((d) => `${d.key}:${d.role}`)).toEqual(active.map((d) => `${d.key}:${d.role}`));
      }
    });
  }
});

describe('view overrides', () => {
  it('can make another candidate the main view, hide views and force a dropped one', async () => {
    const tl = await timelineOf(exampleById('quick-sort')!.code);
    const { all } = detectAll(tl);
    const auto = selectDetections(all);
    expect(auto.map((d) => d.vizId)).toEqual(['array', 'recursionTree', 'callStack']);
    const tree = auto.find((d) => d.vizId === 'recursionTree')!;
    const swapped = selectDetections(all, { primary: tree.key, hidden: [], shown: [], bound: [] });
    expect(swapped.map((d) => `${d.vizId}:${d.role}`)).toEqual(['recursionTree:primary', 'array:secondary', 'callStack:aux']);
    const hidden = selectDetections(all, { primary: null, hidden: [auto[0].key], shown: [], bound: [] });
    expect(hidden.map((d) => `${d.vizId}:${d.role}`)).toEqual(['recursionTree:primary', 'callStack:aux']);
  });

  it('shows a variable with a chosen view as the main view', async () => {
    const tl = await timelineOf(exampleById('dijkstra')!.code);
    const analysis = analyzeTrace(tl);
    const ctx = { tl, analysis };
    const dist = bindingRef(tl, tl.meta.bindings.find((b) => b.name === 'dist')!.id);
    const asArray = visualizerById('array')!.bindTo!(ctx, dist)!;
    expect(asArray).toMatchObject({ vizId: 'array', title: 'dist', key: 'bound:array:1:dist' });
    const active = selectDetections(detectAll(tl).all, { primary: asArray.key, hidden: [], shown: [], bound: [asArray] });
    expect(active[0]).toMatchObject({ vizId: 'array', role: 'primary', title: 'dist' });
    expect(active.some((d) => d.vizId === 'graph')).toBe(true);
    // a Map / Set view refuses an array, and a stack takes it
    expect(visualizerById('hashMap')!.bindTo!(ctx, dist)).toBeNull();
    expect(visualizerById('stack')!.bindTo!(ctx, dist)).toMatchObject({ vizId: 'stack', title: 'dist' });
  });
});
