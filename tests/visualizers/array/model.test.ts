/** Per-step array model: window / interval ranges, colors, settled elements and old → new deltas. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { valueAt } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { COLORS } from '../../../src/scene/primitives/materials';
import { detectArrays, type ArrayBindings } from '../../../src/visualizers/array/detect';
import { buildArrayModel, DIMMED } from '../../../src/visualizers/array/model';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

async function setup(id: string): Promise<{ tl: Timeline; d: Detection<ArrayBindings> }> {
  const tl = await timelineOf(exampleById(id)!.code);
  const [d] = detectArrays({ tl, analysis: analyzeTrace(tl) });
  return { tl, d };
}

const num = (tl: Timeline, ref: ArrayBindings['target'], i: number) => {
  const v = valueAt(tl, ref, i);
  return typeof v === 'number' ? v : null;
};

describe('array model', () => {
  it('window range follows left and right at every step', async () => {
    const { tl, d } = await setup('longest-substring');
    let checked = 0;
    for (let i = 0; i < tl.steps.length; i++) {
      const l = num(tl, d.bindings.window!.left, i);
      const r = num(tl, d.bindings.window!.right, i);
      const m = buildArrayModel(tl, i, d.bindings, d.mode, null);
      if (l === null || r === null) continue;
      expect(m.window).toEqual({ from: l, to: r });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('binary search dims ruled-out elements and marks mid', async () => {
    const { tl, d } = await setup('binary-search');
    const i = tl.steps.findIndex((_, k) => num(tl, d.bindings.interval!.lo, k) === 5 && num(tl, d.bindings.interval!.mid!, k) === 4);
    expect(i).toBeGreaterThan(0);
    const m = buildArrayModel(tl, i, d.bindings, d.mode, null);
    expect(m.interval).toEqual({ from: 5, to: 9 });
    expect(m.elems.slice(0, 4).map((e) => e.color)).toEqual(Array(4).fill(DIMMED));
    expect(m.elems[4].color).toBe(COLORS.current);
    expect(m.elems[5].color).not.toBe(DIMMED);
    expect(m.pointers.map((p) => `${p.name}@${p.index}`)).toEqual(['lo@5', 'hi@9', 'mid@4']);
  });

  it('two pointers dim what lies outside them', async () => {
    const { tl, d } = await setup('two-sum-sorted');
    const i = tl.steps.findIndex((_, k) => num(tl, d.bindings.span!.right, k) === 5);
    const m = buildArrayModel(tl, i, d.bindings, d.mode, null);
    expect(m.elems[6].color).toBe(DIMMED);
    expect(m.elems[5].color).not.toBe(DIMMED);
  });

  it('a sorted array ends with every element settled', async () => {
    const { tl, d } = await setup('bubble-sort');
    const m = buildArrayModel(tl, tl.steps.length - 1, d.bindings, d.mode, null);
    expect(m.bars).toBe(true);
    expect(m.elems.map((e) => e.color)).toEqual(Array(m.length).fill(COLORS.done));
    expect(m.elems.map((e) => e.num)).toEqual([...m.elems.map((e) => e.num)].sort((a, b) => a! - b!));
  });

  it('joins compared elements with an arc and marks swaps', async () => {
    const { tl, d } = await setup('bubble-sort');
    const hl = (i: number) => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
    const kinds = new Set<string>();
    for (let i = 1; i < tl.steps.length; i++) {
      const m = buildArrayModel(tl, i, d.bindings, d.mode, hl(i));
      if (!m.pair) continue;
      kinds.add(m.pair.kind);
      expect(m.pair.b).toBe(m.pair.a + 1);
      if (m.pair.kind === 'swap') {
        const before = buildArrayModel(tl, i - 1, d.bindings, d.mode, null);
        expect(m.elems[m.pair.a].num).toBe(before.elems[m.pair.b].num);
        expect(m.elems[m.pair.b].num).toBe(before.elems[m.pair.a].num);
      }
    }
    expect([...kinds].sort()).toEqual(['compare', 'swap']);
  });

  it('a write shows old → new, and new → old while it is being undone', async () => {
    const { tl, d } = await setup('bubble-sort');
    const i = tl.diffs.findIndex((diff) => diff.heap.some((h) => h.id === d.bindings.objId && h.op === 'set'));
    const write = tl.diffs[i].heap.find((h) => h.id === d.bindings.objId && h.op === 'set')!;
    const forward = buildArrayModel(tl, i, d.bindings, d.mode, { diff: tl.diffs[i], reversed: false, key: `f${i}` });
    expect(forward.delta).toEqual({ index: write.path[0], text: `${write.old} → ${write.value}` });
    expect(forward.elems[write.path[0] as number].color).toBe(COLORS.changed);
    const backward = buildArrayModel(tl, i - 1, d.bindings, d.mode, { diff: tl.diffs[i], reversed: true, key: `b${i}` });
    expect(backward.delta?.text).toBe(`${write.value} → ${write.old}`);
  });
});
