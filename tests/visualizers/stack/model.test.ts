/** Per-step stack model: items bottom → top with stable identities, entering / leaving items both ways, peeks, monotonic values, the cap. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { valueAt } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { previewValue, refId } from '../../../src/engine/timeline/values';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { stackVisualizer } from '../../../src/visualizers/stack';
import type { StackBindings } from '../../../src/visualizers/stack/detect';
import { buildStackModel, MAX_ITEMS, shadeColor, stackRows } from '../../../src/visualizers/stack/model';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** at step i, having stepped back from i + 1 */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });

async function setup(source: string): Promise<{ tl: Timeline; d: Detection<StackBindings> }> {
  const tl = await timelineOf(source);
  const [d] = stackVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  return { tl, d };
}

const example = (id: string) => setup(exampleById(id)!.code);
const opAt = (tl: Timeline, op: string, nth = 0) => tl.diffs.map((d, i) => (d.heap.some((h) => h.op === op) ? i : -1)).filter((i) => i >= 0)[nth];
const texts = (items: { text: string }[]) => items.map((it) => it.text);

describe('stack model', () => {
  it('lists the elements bottom to top at every step, each keeping its key while on the stack', async () => {
    const { tl, d } = await example('valid-parentheses');
    let prev = new Map<string, number>();
    for (let i = 0; i < tl.steps.length; i++) {
      const id = refId(valueAt(tl, d.bindings.target, i));
      const elems = id === null ? [] : tl.snapshots[i].heap.get(id)?.elems?.toArray() ?? [];
      const m = buildStackModel(tl, i, d.bindings, forward(tl, i));
      expect(texts(m.items)).toEqual(elems.map((e) => previewValue(tl, tl.snapshots[i], e, { depth: 1, maxItems: 3, maxString: 8 })));
      expect(m.items.map((it) => it.slot)).toEqual(elems.map((_, k) => k));
      expect(m.top).toBe(elems.length ? elems.length - 1 : null);
      // an element still on the stack keeps its key and its place
      for (const it of m.items) if (prev.has(it.key)) expect(it.index).toBe(prev.get(it.key));
      expect(new Set(m.items.map((it) => it.key)).size).toBe(m.items.length);
      prev = new Map(m.items.map((it) => [it.key, it.index]));
    }
  });

  it('drops a pushed element in on top; stepping back over the push lifts it off', async () => {
    const { tl, d } = await example('valid-parentheses');
    const i = opAt(tl, 'push', 1);
    const m = buildStackModel(tl, i, d.bindings, forward(tl, i));
    expect(m.items).toMatchObject([
      { text: "'('", state: 'idle', isNew: false, color: COLORS.idle },
      { text: "'{'", state: 'pushed', isNew: true, slot: 1, color: COLORS.changed },
    ]);
    expect(m.leaving).toEqual([]);
    const back = buildStackModel(tl, i - 1, d.bindings, backward(tl, i - 1));
    expect(texts(back.items)).toEqual(["'('"]);
    expect(back.leaving).toMatchObject([{ key: m.items[1].key, text: "'{'", state: 'undone', slot: 1, color: COLORS.changed }]);
  });

  it('lifts a popped element off as it was; stepping back over the pop drops it in again', async () => {
    const { tl, d } = await example('valid-parentheses');
    const i = opAt(tl, 'pop');
    const before = buildStackModel(tl, i - 1, d.bindings, forward(tl, i - 1));
    const m = buildStackModel(tl, i, d.bindings, forward(tl, i));
    expect(texts(m.items)).toEqual(["'('", "'{'"]);
    expect(m.items.every((it) => !it.isNew && it.state === 'idle')).toBe(true);
    expect(m.leaving).toMatchObject([{ key: before.items[2].key, text: "'['", state: 'popped', slot: 2, color: COLORS.current }]);
    const back = buildStackModel(tl, i - 1, d.bindings, backward(tl, i - 1));
    expect(back.items[2]).toMatchObject({ key: before.items[2].key, text: "'['", state: 'pushed', isNew: true });
    expect(back.leaving).toEqual([]);
  });

  it('flashes the element peeked at the top', async () => {
    const { tl, d } = await example('next-greater');
    const i = tl.diffs.findIndex((x) => x.reads.length > 0);
    const m = buildStackModel(tl, i, d.bindings, forward(tl, i));
    expect(m.peek).toBe(0);
    expect(m.top).toBe(0);
    expect(m.items).toMatchObject([{ index: 0, state: 'peeked', color: COLORS.current }]);
    // without a highlight (first render) nothing flashes
    expect(buildStackModel(tl, i, d.bindings, null).items[0].state).toBe('idle');
  });

  it('shows the values a stack of indexes stands for and why the next element evicted them', async () => {
    const { tl, d } = await example('next-greater');
    const last = tl.steps.length - 1;
    expect(texts(buildStackModel(tl, last, d.bindings, null).items)).toEqual(['3 · 4', '4 · 3']);
    // i = 3 (nums[3] = 4) pops index 2 (nums[2] = 2) and then index 0 (nums[0] = 2)
    const pops = [opAt(tl, 'pop', 1), opAt(tl, 'pop', 2)].map((i) => buildStackModel(tl, i, d.bindings, forward(tl, i)));
    expect(pops.map((m) => m.leaving)).toMatchObject([
      [{ text: '2 · 2', state: 'evicted', reason: '2 < 4', color: COLORS.error }],
      [{ text: '0 · 2', state: 'evicted', reason: '2 < 4', color: COLORS.error }],
    ]);
    expect(pops[1].items).toEqual([]);
    // values 1 < 2 < 3 < 4 are graded dark → light
    const m = buildStackModel(tl, last, d.bindings, null);
    expect(m.items.map((it) => it.color)).toEqual([shadeColor(1), shadeColor(2 / 3)]);
  });

  it('a pop stepped back over is not an eviction', async () => {
    const { tl, d } = await example('next-greater');
    const i = opAt(tl, 'push', 2);
    const back = buildStackModel(tl, i - 1, d.bindings, backward(tl, i - 1));
    expect(back.leaving).toMatchObject([{ text: '2 · 2', state: 'undone' }]);
    expect(back.leaving[0].reason).toBeUndefined();
  });

  it(`draws the top ${MAX_ITEMS} elements and counts the rest`, async () => {
    const { tl, d } = await setup('const s = [];\nfor (let i = 0; i < 15; i++) s.push(i);\nwhile (s.length > 2) s.pop();\ns.push(99);');
    const m = buildStackModel(tl, opAt(tl, 'pop') - 1, d.bindings, null);
    expect(m.hiddenBelow).toBe(15 - MAX_ITEMS);
    expect(m.items.map((it) => it.index)).toEqual(Array.from({ length: MAX_ITEMS }, (_, k) => 15 - MAX_ITEMS + k));
    expect(m.items.map((it) => it.slot)).toEqual(Array.from({ length: MAX_ITEMS }, (_, k) => k));
    expect(m.top).toBe(14);
    expect(stackRows(tl, d.bindings)).toBe(MAX_ITEMS);
  });

  it.each([['valid-parentheses', 3], ['next-greater', 2]] as const)('sizes for the tallest stack of the run (%s)', async (id, rows) => {
    const { tl, d } = await example(id);
    expect(stackRows(tl, d.bindings)).toBe(rows);
  });

  it('follows the variable to the stack a new call builds', async () => {
    const { tl, d } = await setup(`function depth(s) {
  const st = [];
  for (const c of s) {
    if (c === '(') st.push(c);
    else st.pop();
  }
  return st.length;
}
depth('()(');
depth('()');`);
    expect(buildStackModel(tl, 1, d.bindings, null).exists).toBe(false);
    const decls = tl.diffs.map((x, i) => (x.heap.some((h) => h.op === 'alloc') ? i : -1)).filter((i) => i > 0);
    const second = decls[decls.length - 1];
    expect(texts(buildStackModel(tl, second - 1, d.bindings, null).items)).toEqual(["'('"]);
    const m = buildStackModel(tl, second, d.bindings, forward(tl, second));
    expect(m.exists).toBe(true);
    expect(m.items).toEqual([]);
    expect(m.leaving).toHaveLength(1);
  });
});
