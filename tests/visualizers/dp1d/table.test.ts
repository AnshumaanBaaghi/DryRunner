/** Shared DP table logic: fill order, dependency direction, scoped index values, cell text and colors. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import {
  cellText, deltaText, fillOrder, fillStats, glyphSafe, isDpFill, mixHex, numText, scopedValueAt, scopedValues, type Cell, type WriteStep,
} from '../../../src/visualizers/dp1d/table';
import { timelineOf } from '../../helpers/timeline';

const cells = (...rc: [number, number][]): Cell[] => rc.map(([r, c]) => ({ r, c }));
/** one write per step, cell `w` reading `reads` */
const steps = (list: [Cell, Cell[]][]): WriteStep[] => list.map(([w, reads], k) => ({ step: k + 1, writes: [{ ...w, step: k + 1 }], reads }));
const at = (c: number, r = 0): Cell => ({ r, c });

describe('fill order', () => {
  it('accepts row- and column-major fills in either direction', () => {
    expect(fillOrder(cells([0, 0], [0, 1], [1, 0], [1, 1]))).toBe(1);
    expect(fillOrder(cells([0, 0], [1, 0], [0, 1], [1, 1]))).toBe(1);
    expect(fillOrder(cells([1, 0], [1, 1], [0, 0], [0, 1]))).toBe(1);
    expect(fillOrder(cells([0, 3], [0, 2], [0, 1], [0, 0]))).toBe(1);
  });

  it('scores an arbitrary visiting order low', () => {
    expect(fillOrder(cells([0, 2], [0, 0], [0, 3], [0, 1], [0, 4], [0, 2]))).toBeLessThan(0.8);
  });
});

describe('fill stats', () => {
  it('a recurrence reads only cells filled before (or never written)', () => {
    const s = fillStats(steps([[at(0), []], [at(1), []], [at(2), [at(1), at(0)]], [at(3), [at(2), at(1)]]]));
    expect(s).toEqual({ cells: 4, maxWrites: 1, order: 1, depSteps: 2, forward: 0 });
    expect(isDpFill(s, 3)).toBe(true);
    // a base value outside the written range (dp[n + 1]) is fine
    expect(fillStats(steps([[at(3), [at(4)]], [at(2), [at(3), at(4)]], [at(1), [at(2)]]])).forward).toBe(0);
  });

  it('a relaxation improves a cell from one reached later: not a DP fill', () => {
    // dist[1] = dist[0] + 4, dist[2] = dist[0] + 1, dist[1] = dist[2] + 2
    const s = fillStats(steps([[at(1), [at(0)]], [at(2), [at(0)]], [at(1), [at(2)]]]));
    expect(s.forward).toBe(1);
    expect(isDpFill(s, 2)).toBe(false);
  });

  it('needs a dependency, few rewrites and enough cells', () => {
    expect(isDpFill(fillStats(steps([[at(0), []], [at(1), []], [at(2), []]])), 3)).toBe(false);
    expect(isDpFill(fillStats(steps([[at(0), []], [at(1), [at(0)]], [at(1), [at(0)]], [at(1), [at(0)]]])), 2)).toBe(false);
    expect(isDpFill(fillStats(steps([[at(0), []], [at(1), [at(0)]]])), 3)).toBe(false);
  });
});

describe('scoped values', () => {
  const code = `function f(n) {
  const dp = [];
  for (let i = 0; i <= n; i++) dp[i] = 0;
  for (let i = 2; i <= n; i++) dp[i] = i;
  return dp;
}
f(4);`;

  it('reads the loop counter in scope when a function declares it twice', async () => {
    const tl = await timelineOf(code);
    const ref = analyzeTrace(tl).vars.get(`${tl.meta.fns.find((fn) => fn.name === 'f')!.id}:i`)!.ref;
    const writes = tl.diffs.flatMap((d, s) => d.heap.filter((h) => h.op === 'set').map((h) => ({ s, index: h.path[0], value: h.value })));
    expect(writes).toHaveLength(8);
    // every write `dp[i] = …` happens with i equal to its index, in both loops
    for (const w of writes) expect(scopedValueAt(tl, ref, w.s)).toBe(w.index);
    const values = scopedValues(tl, ref);
    expect(values[0]).toBeUndefined();
    expect(values[values.length - 1]).toBe(5);
  });
});

describe('cell text', () => {
  it('formats numbers compactly', () => {
    expect([42, -7, 0.33333, 1234567, Infinity, -Infinity, NaN].map(numText)).toEqual(['42', '-7', '0.333', '1.2e6', '∞', '-∞', 'NaN']);
  });

  it('shows values without quotes, booleans as ✓ / ✗, holes as nothing', async () => {
    const tl: Timeline = await timelineOf(`const t = [true, false, 'hello', 'ab', null, 2.5, Infinity];
t.length = 8;
console.log(t.length);`);
    const snap = tl.snapshots[tl.steps.length - 1];
    const arr = [...snap.heap.values()].find((o) => o.kind === 'array')!;
    expect(arr.elems!.toArray().map((v) => cellText(tl, snap, v))).toEqual(['✓', '✗', 'hel…', 'ab', 'null', '2.5', '∞', '']);
    expect(cellText(tl, snap, undefined)).toBe('');
    expect(deltaText(tl, snap, { old: undefined, value: 3 }, false)).toBe('· → 3');
    expect(deltaText(tl, snap, { old: 1, value: 3 }, true)).toBe('3 → 1');
  });

  it('replaces characters the label font lacks', () => {
    expect(glyphSafe('ab→é')).toBe('ab→?');
  });
});

describe('colors', () => {
  it('blends hex colors, clamping t', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#ffffff', -1)).toBe('#102030');
    expect(mixHex('#000000', '#22D3EE', 2)).toBe('#22d3ee');
  });
});
