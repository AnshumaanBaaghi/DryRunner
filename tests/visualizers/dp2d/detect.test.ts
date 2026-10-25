/** 2D DP detection: which arrays of rows are filled as DP tables, their index variables, headers, claims and HUD lines. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { dp1dVisualizer } from '../../../src/visualizers/dp1d';
import { dp2dVisualizer } from '../../../src/visualizers/dp2d';
import { DP2D_SCORE, detectDp2d, tableShape, type Dp2dBindings } from '../../../src/visualizers/dp2d/detect';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import { DP_2D, NOT_DP } from '../dp1d/cases';

async function detect(source: string): Promise<{ tl: Timeline; ds: Detection<Dp2dBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, ds: detectDp2d({ tl, analysis: analyzeTrace(tl) }) };
}

const example = (id: string) => exampleById(id)!.code;
const withDp = () => [...visualizers().filter((v) => v.id !== 'dp1d' && v.id !== 'dp2d'), dp1dVisualizer, dp2dVisualizer];
const header = (h: Dp2dBindings['rowHeader']) => (h ? `${h.ref.name}${h.offset ? h.offset : ''}` : null);

/** Every HUD line of the run, in order. */
function hud(tl: Timeline, d: Detection<Dp2dBindings>): string[] {
  return tl.steps.flatMap((_, i) => dp2dVisualizer.describe!(tl, i, d));
}

describe('dp2d detection', () => {
  it('lcs: rows by i, columns by j, the strings as headers, every row claimed', async () => {
    const { tl, ds } = await detect(example('lcs'));
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(d).toMatchObject({ vizId: 'dp2d', title: 'dp', score: DP2D_SCORE, role: 'primary', key: `dp2d:obj:${d.bindings.objId}` });
    const b = d.bindings;
    expect([b.table.name, b.row?.name, b.col?.name]).toEqual(['dp', 'i', 'j']);
    expect([header(b.rowHeader), header(b.colHeader)]).toEqual(['a-1', 'b-1']);
    const shape = tableShape(tl, b.objId);
    expect([shape.rows, shape.cols]).toEqual([8, 7]);
    // the header strings are claimed too: they are drawn along the table, not as array views of their own
    expect(d.claims).toEqual([`obj:${b.objId}`, ...shape.rowIds.map((id) => `obj:${id}`), varKey(b.table), varKey(b.rowHeader!.ref), varKey(b.colHeader!.ref)]);
    expect(shape.rowIds).toHaveLength(8);
  });

  it('edit distance: base row and column written first, words as headers', async () => {
    const { tl, ds } = await detect(example('edit-distance'));
    const [d] = ds;
    expect(ds).toHaveLength(1);
    expect([d.bindings.row?.name, d.bindings.col?.name]).toEqual(['i', 'j']);
    expect([header(d.bindings.rowHeader), header(d.bindings.colHeader)]).toEqual(['word1-1', 'word2-1']);
    expect([tableShape(tl, d.bindings.objId).rows, tableShape(tl, d.bindings.objId).cols]).toEqual([6, 4]);
  });

  it('knapsack: cells written twice, numeric headers', async () => {
    const { ds } = await detect(example('knapsack'));
    const [d] = ds;
    expect(ds).toHaveLength(1);
    expect([d.bindings.row?.name, d.bindings.col?.name]).toEqual(['i', 'w']);
    expect(d.bindings.rowHeader).toBeUndefined();
    expect(d.bindings.colHeader).toBeUndefined();
  });

  it.each([...NOT_DP, 'climbing-stairs'])('finds no 2D DP table in %s', async (id) => {
    expect((await detect(example(id))).ds).toEqual([]);
  });

  it('a column-major fill', async () => {
    const { ds } = await detect(`function paths(m, n) {
  const dp = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < m; r++) dp[r][c] = r === 0 || c === 0 ? 1 : dp[r - 1][c] + dp[r][c - 1];
  }
  return dp[m - 1][n - 1];
}
paths(3, 4);`);
    expect(ds.map((d) => `${d.title}:${d.bindings.row?.name}:${d.bindings.col?.name}`)).toEqual(['dp:r:c']);
  });

  it('a table filled bottom-up from the last row, one string naming both rows and columns', async () => {
    const { ds } = await detect(`function lps(s) {
  const n = s.length;
  const dp = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    dp[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      dp[i][j] = s[i] === s[j] ? dp[i + 1][j - 1] + 2 : Math.max(dp[i + 1][j], dp[i][j - 1]);
    }
  }
  return dp[0][n - 1];
}
lps('bbab');`);
    const [d] = ds;
    expect([d.bindings.row?.name, d.bindings.col?.name]).toEqual(['i', 'j']);
    expect([header(d.bindings.rowHeader), header(d.bindings.colHeader)]).toEqual(['s', 's']);
  });
});

describe('dp2d HUD lines', () => {
  it('lcs: each cell with the cells it was computed from', async () => {
    const { tl, ds } = await detect(example('lcs'));
    expect(dp2dVisualizer.describe!(tl, 0, ds[0])).toEqual([]);
    const lines = hud(tl, ds[0]);
    expect(lines).toHaveLength(42);
    expect(lines.slice(0, 4)).toEqual([
      'fill dp[1][1] from dp[0][1], dp[1][0]', 'fill dp[1][2] from dp[0][2], dp[1][1]', 'fill dp[1][3] from dp[0][3], dp[1][2]',
      'fill dp[1][4] from dp[0][3]',
    ]);
  });

  it('edit distance: base cells have no dependencies', async () => {
    const { tl, ds } = await detect(example('edit-distance'));
    const lines = hud(tl, ds[0]);
    expect(lines.slice(0, 2)).toEqual(['fill dp[0][0]', 'fill dp[1][0]']);
    expect(lines).toContain('fill dp[1][1] from dp[0][1], dp[1][0], dp[0][0]');
  });
});

describe('dp2d selection', () => {
  it.each(DP_2D)('%s: the DP table is the primary view', async (id) => {
    const tl = await timelineOf(example(id));
    const chosen = selectDetections(detectAll(tl, withDp()).all);
    expect(chosen[0]).toMatchObject({ vizId: 'dp2d', role: 'primary', title: 'dp' });
    expect(chosen.some((d) => d.vizId === 'dp1d')).toBe(false);
  });
});
