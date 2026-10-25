/** 2D DP model per step: cell states, heat colors, the write and its dependencies, deltas, current row / column, headers. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { EMPTY, rowsAt } from '../../../src/visualizers/dp1d/table';
import { detectDp2d, type Dp2dBindings } from '../../../src/visualizers/dp2d/detect';
import { buildDp2dModel, heatColor } from '../../../src/visualizers/dp2d/model';
import { timelineOf } from '../../helpers/timeline';

async function setup(id: string): Promise<{ tl: Timeline; b: Dp2dBindings }> {
  const tl = await timelineOf(exampleById(id)!.code);
  const [d] = detectDp2d({ tl, analysis: analyzeTrace(tl) });
  return { tl, b: d.bindings };
}

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** stepping back from i + 1 to i: the undone step's changes */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });

/** Steps writing cell (r, c), in order. */
function writesOf(tl: Timeline, b: Dp2dBindings, r: number, c: number): number[] {
  const out: number[] = [];
  tl.diffs.forEach((d, s) => {
    const rows = rowsAt(tl, b.objId, s);
    if (d.heap.some((h) => h.op === 'set' && rows.get(h.id) === r && h.path[0] === c)) out.push(s);
  });
  return out;
}

describe('dp2d model', () => {
  it('lcs: the write of dp[1][4] from dp[0][3] (a match), its neighbours and the headers', async () => {
    const { tl, b } = await setup('lcs');
    const [w] = writesOf(tl, b, 1, 4);
    const m = buildDp2dModel(tl, w, b, forward(tl, w));
    const k = (r: number, c: number) => r * m.cols + c;
    expect([m.rows, m.cols, m.exists]).toEqual([8, 7, true]);
    expect(m.written).toEqual({ r: 1, c: 4 });
    expect(m.deps).toEqual([{ r: 0, c: 3 }]);
    expect(m.delta).toEqual({ r: 1, c: 4, text: '0 → 1' });
    expect(m.current).toEqual({ r: 1, c: 4 });
    expect(m.focus).toEqual({ r: 1, c: 4 });
    expect(m.state[k(1, 4)]).toBe('written');
    // row 0 is never written: the base border, filled (zeros) from the start
    expect([m.state[k(0, 3)], m.color[k(0, 3)], m.text[k(0, 3)]]).toEqual(['read', heatColor(0), '0']);
    expect([m.state[k(0, 4)], m.state[k(5, 0)]]).toEqual(['filled', 'filled']);
    expect(m.state.slice(k(1, 1), k(1, 4))).toEqual(['filled', 'filled', 'filled']);
    expect([m.state[k(1, 5)], m.color[k(1, 5)], m.text[k(1, 5)]]).toEqual(['empty', EMPTY, '0']);
    // heat relative to the largest value the table reaches (the LCS length, 4)
    expect(m.color[k(1, 4)]).toBe(heatColor(1 / 4));
    expect(m.color[k(1, 1)]).toBe(heatColor(0));
    expect(m.rowHeaders).toEqual(['', 'A', 'B', 'C', 'B', 'D', 'A', 'B']);
    expect(m.colHeaders).toEqual(['', 'B', 'D', 'C', 'A', 'B', 'A']);
  });

  it('stepping back over the write: new → old, the cell uncomputed again', async () => {
    const { tl, b } = await setup('lcs');
    const [w] = writesOf(tl, b, 1, 4);
    const m = buildDp2dModel(tl, w - 1, b, backward(tl, w - 1));
    const k = 1 * m.cols + 4;
    expect(m.delta).toEqual({ r: 1, c: 4, text: '1 → 0' });
    expect([m.state[k], m.color[k]]).toEqual(['written', EMPTY]);
    expect(m.deps).toEqual([{ r: 0, c: 3 }]);
    expect(m.current).toEqual({ r: 1, c: 3 });
  });

  it('the finished table: every computed cell colored, the answer brightest with dark text', async () => {
    const { tl, b } = await setup('lcs');
    const last = tl.steps.length - 1;
    const m = buildDp2dModel(tl, last, b, forward(tl, last));
    const k = 7 * m.cols + 6;
    expect(m.text[k]).toBe('4');
    expect([m.color[k], m.ink[k]]).toEqual([heatColor(1), COLORS.bg]);
    // 42 computed cells plus the border of zeros
    expect(m.state.every((s) => s === 'filled')).toBe(true);
    expect(m.ink[1 * m.cols + 1]).toBe(COLORS.ink);
  });

  it('once the table exists, only the border is filled before the first write', async () => {
    const { tl, b } = await setup('lcs');
    const created = tl.steps.findIndex((_, s) => tl.snapshots[s].heap.has(b.objId));
    const m = buildDp2dModel(tl, created, b, forward(tl, created));
    const filled = m.state.flatMap((s, k) => (s === 'filled' ? [`${Math.floor(k / m.cols)}:${k % m.cols}`] : []));
    expect(filled).toHaveLength(7 + 7);
    expect(filled.every((key) => key.startsWith('0:') || key.endsWith(':0'))).toBe(true);
    expect(m.current).toBeNull();
  });

  it('keeps one board size through the trace, empty before the table exists', async () => {
    const { tl, b } = await setup('edit-distance');
    const sizes = new Set<string>();
    for (let i = 0; i < tl.steps.length; i += 5) {
      const m = buildDp2dModel(tl, i, b, forward(tl, i));
      sizes.add(`${m.rows}x${m.cols}:${m.text.length}`);
    }
    expect([...sizes]).toEqual(['6x4:24']);
    const early = buildDp2dModel(tl, 1, b, forward(tl, 1));
    expect(early.exists).toBe(false);
    expect(early.state.every((s) => s === 'empty')).toBe(true);
    expect(early.current).toBeNull();
    const m = buildDp2dModel(tl, tl.steps.length - 1, b, null);
    expect(m.rowHeaders).toEqual(['', 'h', 'o', 'r', 's', 'e']);
    expect(m.colHeaders).toEqual(['', 'r', 'o', 's']);
    expect(m.text[5 * 4 + 3]).toBe('3');
  });

  it('knapsack: a cell rewritten in the same iteration, numeric headers', async () => {
    const { tl, b } = await setup('knapsack');
    const [first, second] = writesOf(tl, b, 1, 1);
    expect(second).toBeGreaterThan(first);
    const m = buildDp2dModel(tl, second, b, forward(tl, second));
    expect(m.delta?.text).toBe('0 → 1');
    expect(m.deps).toEqual([{ r: 0, c: 0 }]);
    // row 0 (no items) is never written: base zeros; the rest of the board fills row by row
    expect(m.state.slice(0, m.cols).every((s) => s === 'filled' || s === 'read')).toBe(true);
    expect(m.state[2 * m.cols]).toBe('empty');
    expect(m.rowHeaders).toEqual(['0', '1', '2', '3', '4']);
    expect(m.colHeaders).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    // between writes the current cell stays on the last one written
    const after = buildDp2dModel(tl, second + 1, b, forward(tl, second + 1));
    expect(after.written).toBeNull();
    expect(after.current).toEqual({ r: 1, c: 1 });
    expect(after.focus).toEqual({ r: 1, c: 1 });
  });
});
