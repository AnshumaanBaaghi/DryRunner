import { describe, expect, it } from 'vitest';
import { evaluateWatch } from '../../src/engine/watch/evaluate';
import { timelineOf } from '../helpers/timeline';

const WINDOW = `function longest(s) {
  const seen = new Map();
  let left = 0, best = 0;
  for (let right = 0; right < s.length; right++) {
    if (seen.has(s[right])) left = Math.max(left, seen.get(s[right]) + 1);
    seen.set(s[right], right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}
longest('abcab');`;

describe('watch expressions', () => {
  it('evaluates against the current frame at any step', async () => {
    const tl = await timelineOf(WINDOW);
    const at = tl.steps.findLastIndex((s) => s.kind === 'stmt' && s.line === 7);
    const val = (expr: string) => {
      const r = evaluateWatch(tl, at, expr);
      return r.ok ? r.value : `ERR ${r.error}`;
    };
    expect(val('right - left + 1')).toBe(3);
    expect(val('s.length')).toBe(5);
    expect(val('s.slice(left, right + 1)')).toBe('cab');
    expect(val('seen.size')).toBe(3);
    expect(val("seen.get('a')")).toBe(3);
    expect(val("seen.has('z') ? 1 : 2")).toBe(2);
    expect(val('Math.max(best, 10)')).toBe(10);
    expect(val('[left, right]')).toEqual([2, 4]);
  });

  it('is safe: no prototype access, no arbitrary calls, unknown names are errors', async () => {
    const tl = await timelineOf(WINDOW);
    const at = tl.steps.length - 2;
    for (const expr of ['s.constructor', 'seen.__proto__', 'fetch("x")', 'nope + 1', '(() => 1)()']) {
      const r = evaluateWatch(tl, at, expr);
      expect(r.ok).toBe(false);
    }
  });
});
