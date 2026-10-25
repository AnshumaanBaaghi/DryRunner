/** 1D DP model per step: cell states and colors, dependencies of the write, deltas (both directions), the pointer. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { detectDp1d, type Dp1dBindings } from '../../../src/visualizers/dp1d/detect';
import { arcBend, buildDp1dModel, FILLED, xOf } from '../../../src/visualizers/dp1d/model';
import { EMPTY } from '../../../src/visualizers/dp1d/table';
import { timelineOf } from '../../helpers/timeline';

async function setup(source: string): Promise<{ tl: Timeline; b: Dp1dBindings }> {
  const tl = await timelineOf(source);
  const [d] = detectDp1d({ tl, analysis: analyzeTrace(tl) });
  return { tl, b: d.bindings };
}

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** stepping back from i + 1 to i: the undone step's changes */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });
const writeStep = (tl: Timeline, b: Dp1dBindings, index: number, from = 0) =>
  tl.diffs.findIndex((d, s) => s >= from && d.heap.some((h) => h.id === b.objId && h.op === 'set' && h.path[0] === index));

describe('dp1d model', () => {
  it('the write of dp[4]: read cells amber, the written cell orange, arcs from dp[3] and dp[2]', async () => {
    const { tl, b } = await setup(exampleById('climbing-stairs')!.code);
    const w = writeStep(tl, b, 4);
    const m = buildDp1dModel(tl, w, b, forward(tl, w));
    expect(m.exists).toBe(true);
    expect(m.maxLen).toBe(7);
    expect(m.cells.map((c) => c.state)).toEqual(['filled', 'filled', 'read', 'read', 'written', 'empty', 'empty']);
    expect(m.cells.map((c) => c.color)).toEqual([FILLED, FILLED, COLORS.current, COLORS.current, COLORS.changed, EMPTY, EMPTY]);
    expect(m.cells.map((c) => c.text)).toEqual(['1', '1', '2', '3', '5', '0', '0']);
    expect(m.written).toBe(4);
    expect(m.deps).toEqual([{ from: 3, to: 4 }, { from: 2, to: 4 }]);
    expect(m.delta).toEqual({ index: 4, text: '0 → 5' });
    expect(m.pointer).toEqual({ name: 'i', index: 4, x: xOf(4, 7) });
    expect(m.focusIndex).toBe(4);
    expect(m.cells.map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5, 6].map((k) => xOf(k, 7)));
  });

  it('stepping back over the write shows new → old and the cell as it was', async () => {
    const { tl, b } = await setup(exampleById('climbing-stairs')!.code);
    const w = writeStep(tl, b, 4);
    const m = buildDp1dModel(tl, w - 1, b, backward(tl, w - 1));
    expect(m.delta).toEqual({ index: 4, text: '5 → 0' });
    expect(m.cells[4]).toMatchObject({ state: 'written', text: '0', color: COLORS.changed });
    expect(m.deps).toEqual([{ from: 3, to: 4 }, { from: 2, to: 4 }]);
    expect(buildDp1dModel(tl, w - 1, b, null).cells[4].state).toBe('empty');
  });

  it('a read-only step marks the cell read without a dependency or delta', async () => {
    const { tl, b } = await setup(exampleById('climbing-stairs')!.code);
    const ret = tl.steps.findIndex((s) => s.kind === 'return');
    const m = buildDp1dModel(tl, ret, b, forward(tl, ret));
    expect(m.cells[6].state).toBe('read');
    expect(m.written).toBeNull();
    expect(m.deps).toEqual([]);
    expect(m.delta).toBeNull();
    expect(m.focusIndex).toBe(6);
  });

  it('before the table exists and once it is complete', async () => {
    const { tl, b } = await setup(exampleById('climbing-stairs')!.code);
    const early = buildDp1dModel(tl, 1, b, forward(tl, 1));
    expect(early).toMatchObject({ exists: false, cells: [], maxLen: 7, written: null, delta: null });
    const end = buildDp1dModel(tl, tl.steps.length - 1, b, forward(tl, tl.steps.length - 1));
    expect(end.cells.map((c) => c.text)).toEqual(['1', '1', '2', '3', '5', '8', '13']);
    expect(end.cells.every((c) => c.state === 'filled')).toBe(true);
    // the loop ended with i one past the last cell: the pointer stays there, the camera has nothing to follow
    expect(end.pointer?.index).toBe(7);
    expect(end.focusIndex).toBeNull();
  });

  it('follows the loop counter in scope when a function has two loops over i', async () => {
    const { tl, b } = await setup(`function f(n) {
  const dp = [];
  for (let i = 0; i <= n; i++) dp[i] = 0;
  dp[1] = 1;
  for (let i = 2; i <= n; i++) dp[i] = dp[i - 1] + dp[i - 2];
  return dp[n];
}
f(6);`);
    expect(b.index?.name).toBe('i');
    const first = writeStep(tl, b, 5);
    const second = writeStep(tl, b, 5, first + 1);
    expect(buildDp1dModel(tl, first, b, forward(tl, first)).delta?.text).toBe('· → 0');
    const m = buildDp1dModel(tl, second, b, forward(tl, second));
    expect(m.pointer?.index).toBe(5);
    expect(m.delta?.text).toBe('0 → 5');
    expect(m.deps).toEqual([{ from: 4, to: 5 }, { from: 3, to: 5 }]);
  });

  it('cells read but never written are base values, filled from the start', async () => {
    const { tl, b } = await setup(`function minCost(cost) {
  const n = cost.length;
  const dp = new Array(n + 2).fill(0);
  for (let i = n - 1; i >= 0; i--) dp[i] = cost[i] + Math.min(dp[i + 1], dp[i + 2]);
  return Math.min(dp[0], dp[1]);
}
minCost([10, 15, 20, 5, 8]);`);
    const first = writeStep(tl, b, 4);
    const m = buildDp1dModel(tl, first, b, forward(tl, first));
    expect(m.cells.map((c) => c.state)).toEqual(['empty', 'empty', 'empty', 'empty', 'written', 'read', 'read']);
    expect(m.deps).toEqual([{ from: 5, to: 4 }, { from: 6, to: 4 }]);
    expect(buildDp1dModel(tl, first - 1, b, null).cells.map((c) => c.state)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty', 'filled', 'filled']);
  });

  it('keeps dependency arcs low however far they reach', () => {
    for (const dist of [1.08, 2.16, 5, 20]) expect(dist * arcBend(dist) * 0.175).toBeLessThanOrEqual(0.56 + 1e-9);
    expect(arcBend(1.08)).toBe(0.8);
  });
});
