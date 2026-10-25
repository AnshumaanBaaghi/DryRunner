/** Recursion-tree detection (plain, mutual, divide and conquer) and its per-node helpers. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { detectRecursion } from '../../../src/visualizers/recursionTree/detect';
import { dcArrays, runningCall, shortLabel, sortMoves } from '../../../src/visualizers/recursionTree/model';
import { buildCallTree, constantArgs } from '../../../src/visualizers/shared/callTree';
import { timelineOf } from '../../helpers/timeline';

const detect = async (code: string) => {
  const tl = await timelineOf(code);
  return { tl, found: detectRecursion({ tl, analysis: analyzeTrace(tl) }) };
};
const fnName = (tl: Awaited<ReturnType<typeof timelineOf>>, id: number) => tl.meta.fns[id].name;

describe('recursion tree detection', () => {
  it.each(['fibonacci', 'factorial', 'quick-sort'])('draws %s as a plain recursion tree', async (id) => {
    const { tl, found } = await detect(exampleById(id)!.code);
    expect(found).toHaveLength(1);
    const [d] = found;
    expect(d.bindings.dc).toBe(false);
    expect(d.mode).toBeUndefined();
    expect(d.claims).toEqual(d.bindings.fnIds.map((f) => `fn:${f}`));
    expect(d.bindings.fnIds.map((f) => fnName(tl, f))).toEqual([d.title]);
  });

  it('recognizes divide and conquer and the merge helper with its pointers', async () => {
    const { tl, found } = await detect(exampleById('merge-sort')!.code);
    const [d] = found;
    expect(d.mode).toBe('divide-and-conquer');
    expect(d.title).toBe('mergeSort');
    const combine = d.bindings.combine!;
    expect(fnName(tl, combine.fnId)).toBe('merge');
    expect(combine.arrays.map((a) => `${a.target.name}:${a.pointers.map((p) => p.ref.name).join('')}`)).toEqual(['left:i', 'right:j', 'result:']);
  });

  it('groups mutually recursive functions into one tree', async () => {
    const { found } = await detect(`function isEven(n) { return n === 0 ? true : isOdd(n - 1); }
function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
console.log(isEven(4));`);
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('isEven ↔ isOdd');
    expect(found[0].bindings.fnIds).toHaveLength(2);
  });

  it('ignores programs without recursion', async () => {
    expect((await detect(exampleById('bubble-sort')!.code)).found).toEqual([]);
  });
});

describe('recursion tree model', () => {
  it('labels calls without arguments that never change', async () => {
    const { tl, found } = await detect(exampleById('quick-sort')!.code);
    const tree = buildCallTree(tl, found[0].bindings.fnIds);
    const constant = constantArgs(tree);
    const labels = [...tree.nodes.values()].map((n) => shortLabel(tl, tl.snapshots[n.enterStep], n, constant.get(n.fnId)));
    expect(labels[0]).toBe('quickSort(0, 7)');
    expect(labels.every((l) => /^quickSort\(-?\d+, -?\d+\)$/.test(l))).toBe(true);
  });

  it('gives divide-and-conquer calls their input and returned arrays', async () => {
    const { tl, found } = await detect(exampleById('merge-sort')!.code);
    const tree = buildCallTree(tl, found[0].bindings.fnIds);
    const root = tree.nodes.get(tree.roots[0])!;
    const { input, output } = dcArrays(tl, root);
    expect(input).toEqual([38, 27, 43, 3, 9, 82, 10]);
    expect(output).toEqual([3, 9, 10, 27, 38, 43, 82]);
    const leaf = [...tree.nodes.values()].find((n) => n.children.length === 0)!;
    expect(dcArrays(tl, leaf).input).toHaveLength(1);
  });

  it('knows when the merge helper is running', async () => {
    const { tl, found } = await detect(exampleById('merge-sort')!.code);
    const mergeId = found[0].bindings.combine!.fnId;
    const inside = tl.steps.findIndex((s) => tl.calls.get(s.callId)?.fnId === mergeId);
    expect(runningCall(tl, inside, mergeId)).toBe(tl.steps[inside].callId);
    expect(runningCall(tl, 1, mergeId)).toBeNull();
  });

  it('moves each element from its input slot to its sorted slot, stable for equal values', () => {
    expect(sortMoves([3, 1, 3, 2], [1, 2, 3, 3])).toEqual([
      { value: 1, from: 1, to: 0 }, { value: 2, from: 3, to: 1 }, { value: 3, from: 0, to: 2 }, { value: 3, from: 2, to: 3 },
    ]);
  });
});
