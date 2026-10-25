import { describe, expect, it } from 'vitest';
import { describeStep, loopStatus } from '../../src/engine/describe/narrate';
import { timelineOf } from '../helpers/timeline';

describe('narration and evaluation chains', () => {
  it('describes the acceptance loop step by step', async () => {
    const tl = await timelineOf(`let sum = 0;
for (let i = 0; i < 5; i++) {
  sum += i;
}`);
    expect(describeStep(tl, 3).chain).toEqual(['i < 5', '0 < 5', 'true']);
    expect(describeStep(tl, 3).title).toMatch(/iteration 1/);
    expect(describeStep(tl, 16).chain).toEqual(['sum += i', 'sum = 6 + 4 = 10']);
    expect(describeStep(tl, 17).chain).toEqual(['i++', 'i: 4 → 5']);
    expect(describeStep(tl, 18).chain).toEqual(['i < 5', '5 < 5', 'false']);
    expect(describeStep(tl, 18).title).toMatch(/exits after 5 iterations/);
    expect(loopStatus(tl, 13)).toEqual([{ loopId: 0, line: 2, kind: 'for', iteration: 4, counters: [['i', '3']] }]);
  });

  it('renders DP recurrences in index and value form', async () => {
    const tl = await timelineOf(`const dp = [1, 1, 0, 0, 0];
for (let i = 2; i < 5; i++) {
  dp[i] = dp[i - 1] + dp[i - 2];
}`);
    const chains = tl.steps.map((_, i) => describeStep(tl, i).chain.join(' → '));
    expect(chains).toContain('dp[i] = dp[i - 1] + dp[i - 2] → dp[4] = 3 + 2 = 5');
  });

  it('narrates calls and returns with values', async () => {
    const tl = await timelineOf(`function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
console.log(fib(2));`);
    expect(describeStep(tl, 1).title).toBe('fib(2) called from the top level (line 5)');
    expect(describeStep(tl, 3).title).toBe('fib(1) called from fib(2) (line 3)');
    const ret = tl.steps.findIndex((s) => s.kind === 'return' && s.depth === 1);
    expect(describeStep(tl, ret).chain).toEqual(['return fib(n - 1) + fib(n - 2)', '1 + 0 = 1']);
    const print = tl.steps.findIndex((s) => s.kind === 'stmt' && s.line === 5);
    expect(describeStep(tl, print)).toMatchObject({ title: 'Printed: 1', chain: ['console.log(fib(2))', 'console.log(1)'] });
  });

  it('explains limits at the end', async () => {
    const tl = await timelineOf('while (true) {}', { maxSteps: 50 });
    expect(describeStep(tl, tl.steps.length - 1).title).toMatch(/step limit/);
  });
});
