/** Memo HUD lines: results stored in the cache, calls answered from it. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { memoVisualizer } from '../../../src/visualizers/memo';
import { timelineOf } from '../../helpers/timeline';

/** Every non-empty HUD block of the run, in order. */
async function hud(source: string): Promise<string[][]> {
  const tl = await timelineOf(source);
  const [d] = memoVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  const out: string[][] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const lines = memoVisualizer.describe!(tl, i, d);
    if (lines.length) out.push(lines);
  }
  expect(memoVisualizer.describe!(tl, 0, d)).toEqual([]);
  return out;
}

describe('memo describe', () => {
  it('fibonacci-memo: each store and each hit, one line per step', async () => {
    const blocks = await hud(exampleById('fibonacci-memo')!.code);
    expect(blocks.every((b) => b.length === 1)).toBe(true);
    expect(blocks.flat()).toEqual([
      'stored fib(2) = 1 in memo', 'stored fib(3) = 2 in memo', 'cache hit: fib(2) = 1', 'stored fib(4) = 3 in memo',
      'cache hit: fib(3) = 2', 'stored fib(5) = 5 in memo', 'cache hit: fib(4) = 3', 'stored fib(6) = 8 in memo',
      'cache hit: fib(5) = 5', 'stored fib(7) = 13 in memo', 'cache hit: fib(6) = 8', 'stored fib(8) = 21 in memo',
    ]);
  });

  it('names the cache variable and shows non-numeric keys and values', async () => {
    const lines = (await hud(`function canBreak(s, words) {
  const seen = new Map();
  function go(i) {
    if (i === s.length) return true;
    if (seen.has(i)) return seen.get(i);
    let ok = false;
    for (const w of words) if (!ok && s.startsWith(w, i)) ok = go(i + w.length);
    seen.set(i, ok);
    return ok;
  }
  return go(0);
}
canBreak('aaab', ['a', 'aa']);`)).flat();
    expect(lines).toContain('stored go(3) = false in seen');
    expect(lines).toContain('cache hit: go(2) = false');
    expect(lines.filter((l) => l.startsWith('cache hit'))).not.toHaveLength(0);
  });
});
