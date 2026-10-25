/** 1D DP detection: which arrays are filled as DP tables, what they claim, and the HUD line per write. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { dp1dVisualizer } from '../../../src/visualizers/dp1d';
import { DP1D_SCORE, detectDp1d, type Dp1dBindings } from '../../../src/visualizers/dp1d/detect';
import { dp2dVisualizer } from '../../../src/visualizers/dp2d';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import { DP_2D, NOT_DP } from './cases';

async function detect(source: string): Promise<{ tl: Timeline; ds: Detection<Dp1dBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, ds: detectDp1d({ tl, analysis: analyzeTrace(tl) }) };
}

const example = (id: string) => exampleById(id)!.code;
const withDp = () => [...visualizers().filter((v) => v.id !== 'dp1d' && v.id !== 'dp2d'), dp1dVisualizer, dp2dVisualizer];

/** Every HUD line of the run, in order. */
function hud(tl: Timeline, d: Detection<Dp1dBindings>): string[] {
  return tl.steps.flatMap((_, i) => dp1dVisualizer.describe!(tl, i, d));
}

describe('dp1d detection', () => {
  it('climbing stairs: dp filled from dp[i - 1] and dp[i - 2], driven by i', async () => {
    const { tl, ds } = await detect(example('climbing-stairs'));
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(d).toMatchObject({ vizId: 'dp1d', title: 'dp', score: DP1D_SCORE, role: 'primary' });
    expect(d.bindings.table.name).toBe('dp');
    expect(d.bindings.index?.name).toBe('i');
    expect(d.key).toBe(`dp1d:obj:${d.bindings.objId}`);
    expect(d.claims).toEqual([`obj:${d.bindings.objId}`, varKey(d.bindings.table)]);
    expect(tl.snapshots[tl.steps.length - 1].heap.get(d.bindings.objId)?.elems?.toArray()).toEqual([1, 1, 2, 3, 5, 8, 13]);
  });

  it.each(NOT_DP)('finds no 1D DP table in %s', async (id) => {
    expect((await detect(example(id))).ds).toEqual([]);
  });

  it.each(DP_2D)('leaves the rows of the 2D table in %s to dp2d', async (id) => {
    expect((await detect(example(id))).ds).toEqual([]);
  });

  it('a max recurrence (house robber)', async () => {
    const { tl, ds } = await detect(`function rob(nums) {
  const dp = new Array(nums.length).fill(0);
  dp[0] = nums[0];
  dp[1] = Math.max(nums[0], nums[1]);
  for (let i = 2; i < nums.length; i++) dp[i] = Math.max(dp[i - 1], dp[i - 2] + nums[i]);
  return dp[nums.length - 1];
}
rob([2, 7, 9, 3, 1]);`);
    const [d] = ds;
    expect(d.bindings.index?.name).toBe('i');
    expect(hud(tl, d)).toEqual(['fill dp[0]', 'fill dp[1]', 'dp[2] ← dp[1], dp[0]', 'dp[3] ← dp[2], dp[1]', 'dp[4] ← dp[3], dp[2]']);
  });

  it('a table filled from the end, reading cells past the last one as base values', async () => {
    const { ds } = await detect(`function minCost(cost) {
  const n = cost.length;
  const dp = new Array(n + 2).fill(0);
  for (let i = n - 1; i >= 0; i--) dp[i] = cost[i] + Math.min(dp[i + 1], dp[i + 2]);
  return Math.min(dp[0], dp[1]);
}
minCost([10, 15, 20, 5, 8]);`);
    expect(ds.map((d) => `${d.title}:${d.bindings.index?.name}`)).toEqual(['dp:i']);
  });

  it('ignores arrays written without reading their own cells, or counted into', async () => {
    expect((await detect(`const a = [3, 1, 2, 5];
const b = new Array(4).fill(0);
for (let i = 0; i < 4; i++) b[i] = a[i] * 2;`)).ds).toEqual([]);
    expect((await detect(`const counts = new Array(5).fill(0);
for (const x of [1, 3, 1, 4, 1, 3, 0, 2]) counts[x]++;`)).ds).toEqual([]);
  });
});

describe('dp1d HUD lines', () => {
  it('names each written cell and the cells it read', async () => {
    const { tl, ds } = await detect(example('climbing-stairs'));
    expect(dp1dVisualizer.describe!(tl, 0, ds[0])).toEqual([]);
    expect(hud(tl, ds[0])).toEqual([
      'fill dp[0]', 'fill dp[1]', 'dp[2] ← dp[1], dp[0]', 'dp[3] ← dp[2], dp[1]', 'dp[4] ← dp[3], dp[2]', 'dp[5] ← dp[4], dp[3]',
      'dp[6] ← dp[5], dp[4]',
    ]);
  });
});

describe('dp1d selection', () => {
  it('climbing stairs: the DP table takes the array over as the primary view', async () => {
    const tl = await timelineOf(example('climbing-stairs'));
    const chosen = selectDetections(detectAll(tl, withDp()).all);
    expect(chosen[0]).toMatchObject({ vizId: 'dp1d', role: 'primary', title: 'dp' });
    expect(chosen.some((d) => d.vizId === 'array')).toBe(false);
  });
});
