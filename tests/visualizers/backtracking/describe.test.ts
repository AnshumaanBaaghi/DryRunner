/** Backtracking HUD lines: choices made and undone, solutions found, dead ends. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { backtrackingVisualizer } from '../../../src/visualizers/backtracking';
import { timelineOf } from '../../helpers/timeline';

/** Every non-empty HUD block of the run, in order. */
async function hud(id: string): Promise<string[][]> {
  const tl = await timelineOf(exampleById(id)!.code);
  const [d] = backtrackingVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  const out: string[][] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const lines = backtrackingVisualizer.describe!(tl, i, d);
    if (lines.length) out.push(lines);
  }
  expect(backtrackingVisualizer.describe!(tl, 0, d)).toEqual([]);
  return out;
}

describe('backtracking describe', () => {
  it('subsets: each choice and undo with the path, solutions numbered in order', async () => {
    const lines = (await hud('subsets')).flat();
    expect(lines.slice(0, 8)).toEqual([
      'solution #1 found', 'choose +1 → path [1]', 'solution #2 found', 'choose +2 → path [1, 2]',
      'solution #3 found', 'choose +3 → path [1, 2, 3]', 'solution #4 found', 'undo +3 → path [1, 2]',
    ]);
    expect(lines.filter((l) => l.startsWith('solution'))).toHaveLength(8);
    expect(lines.filter((l) => l.startsWith('choose'))).toHaveLength(7);
    expect(lines.filter((l) => l.startsWith('undo'))).toHaveLength(7);
    expect(lines.some((l) => l.startsWith('dead end'))).toBe(false);
  });

  it('n-queens: queens placed and removed by cell, dead ends backing out', async () => {
    const lines = (await hud('n-queens')).flat();
    expect(lines.slice(0, 4)).toEqual(['place queen at (0,0)', 'place queen at (1,2)', 'dead end: place(2) backtracks', 'remove queen from (1,2)']);
    expect(lines.filter((l) => l.startsWith('place queen'))).toHaveLength(lines.filter((l) => l.startsWith('remove queen')).length);
    expect(lines.filter((l) => l.startsWith('solution'))).toEqual(['solution #1 found', 'solution #2 found']);
    expect(lines.filter((l) => l.startsWith('dead end')).length).toBeGreaterThan(3);
  });

  it('permutations: the used flags marked and unmarked next to the path', async () => {
    const blocks = await hud('permutations');
    expect(blocks.slice(0, 2)).toEqual([['mark used[0]'], ['choose +1 → path [1]']]);
    const lines = blocks.flat();
    expect(lines).toContain('unmark used[2]');
    expect(lines.filter((l) => l.startsWith('solution'))).toHaveLength(6);
  });
});
