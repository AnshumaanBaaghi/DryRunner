/** Element identities move with values (so bars visibly travel) instead of staying with slots. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { detectArrays } from '../../../src/visualizers/array/detect';
import { idsAt } from '../../../src/visualizers/array/identity';
import { timelineOf } from '../../helpers/timeline';

describe('array element identity', () => {
  it('follows every swap of a sort: each slot shows the value its element started with', async () => {
    const tl = await timelineOf(exampleById('bubble-sort')!.code);
    const [d] = detectArrays({ tl, analysis: analyzeTrace(tl) });
    const id = d.bindings.objId!;
    const start = tl.steps.findIndex((_, i) => idsAt(tl, id, i) !== null);
    const initial = new Map<number, unknown>();
    const elems = (i: number) => tl.snapshots[i].heap.get(id)!.elems!.toArray();
    idsAt(tl, id, start)!.forEach((e, k) => initial.set(e, elems(start)[k]));
    for (let i = start; i < tl.steps.length; i++) {
      const ids = idsAt(tl, id, i)!;
      expect(ids.map((e) => initial.get(e))).toEqual(elems(i));
    }
  });

  it('tracks push, shift, unshift, splice and reverse', async () => {
    const tl = await timelineOf('const q = [1, 2];\nq.push(3);\nq.shift();\nq.unshift(0);\nq.splice(1, 1);\nq.reverse();');
    const id = tl.diffs.flatMap((d) => d.heap).find((h) => h.op === 'alloc')!.id;
    const at = (line: number) => idsAt(tl, id, tl.steps.findIndex((s) => s.line === line && s.kind === 'stmt'));
    expect(at(1)).toEqual([0, 1]);
    expect(at(2)).toEqual([0, 1, 2]);
    expect(at(3)).toEqual([1, 2]);
    expect(at(4)).toEqual([3, 1, 2]);
    expect(at(5)).toEqual([3, 2]);
    expect(at(6)).toEqual([2, 3]);
  });
});
