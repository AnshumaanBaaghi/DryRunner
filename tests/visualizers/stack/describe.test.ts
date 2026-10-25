/** Stack HUD lines: pushes, pops, peeks and, on a monotonic stack, the comparison that evicted an element. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { stackVisualizer } from '../../../src/visualizers/stack';
import { timelineOf } from '../../helpers/timeline';

/** Every HUD line of the run, in order, and the steps that produced none. */
async function notes(source: string): Promise<{ tl: Timeline; lines: string[]; quiet: number[] }> {
  const tl = await timelineOf(source);
  const [d] = stackVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  const perStep = tl.steps.map((_, i) => stackVisualizer.describe!(tl, i, d));
  return { tl, lines: perStep.flat(), quiet: perStep.flatMap((l, i) => (l.length ? [] : [i])) };
}

describe('stack HUD lines', () => {
  it('names what is pushed and popped', async () => {
    const { lines } = await notes(exampleById('valid-parentheses')!.code);
    expect(lines).toEqual([`push '('`, `push '{'`, `push '['`, `pop → '['`, `pop → '{'`, `pop → '('`, `push '['`, `pop → '['`]);
  });

  it('on a monotonic stack of indexes: the values they index, peeks, and why a pop happened', async () => {
    const { lines } = await notes(exampleById('next-greater')!.code);
    expect(lines).toEqual([
      'push 0 (nums[0] = 2)',
      'peek → 0 (nums[0] = 2)',
      'push 1 (nums[1] = 1)',
      'peek → 1 (nums[1] = 1)',
      'pop 1 (1 < 2)',
      'peek → 0 (nums[0] = 2)',
      'push 2 (nums[2] = 2)',
      'peek → 2 (nums[2] = 2)',
      'pop 2 (2 < 4)',
      'peek → 0 (nums[0] = 2)',
      'pop 0 (2 < 4)',
      'push 3 (nums[3] = 4)',
      'peek → 3 (nums[3] = 4)',
      'push 4 (nums[4] = 3)',
    ]);
  });

  it('stays quiet when the stack is untouched', async () => {
    const { tl, quiet } = await notes(exampleById('valid-parentheses')!.code);
    expect(quiet).toContain(0);
    expect(quiet).toContain(tl.steps.length - 1);
    expect(quiet.length).toBe(tl.steps.length - 8);
  });

  it('shows plain peeks, pops left without a next element, and several pushes on one line', async () => {
    const { lines } = await notes(`const s = [];
s.push(1, 2, 3, 4, 5, 6);
s.pop();
const top = s[s.length - 1];
s.push(9);`);
    expect(lines).toEqual(['push 1, 2, 3, 4, …', 'pop → 6', 'peek → 5', 'push 9']);
    const drained = await notes(`const stack = [];
for (const x of [3, 1, 2]) {
  while (stack.length && stack[stack.length - 1] < x) stack.pop();
  stack.push(x);
}
while (stack.length) stack.pop();`);
    expect(drained.lines.filter((l) => l.startsWith('pop'))).toEqual(['pop 1 (1 < 2)', 'pop → 2', 'pop → 3']);
  });
});
