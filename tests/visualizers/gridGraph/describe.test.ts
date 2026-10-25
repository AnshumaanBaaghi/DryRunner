/** Grid-graph HUD lines: cells probed (and stepped onto off the grid), cells sunk / filled / visited, islands counted. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { gridGraphVisualizer } from '../../../src/visualizers/gridGraph';
import { timelineOf } from '../../helpers/timeline';
import { FLOOD_FILL_BFS, HEAD_INDEX_BFS, ISLANDS_BFS_SET, MAZE_VISITED } from './cases';

/** Every non-empty HUD block of the run, in order. */
async function hud(source: string): Promise<string[][]> {
  const tl = await timelineOf(source);
  const [d] = gridGraphVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  expect(gridGraphVisualizer.describe!(tl, 0, d)).toEqual([]);
  const out: string[][] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const lines = gridGraphVisualizer.describe!(tl, i, d);
    if (lines.length) out.push(lines);
  }
  return out;
}

describe('gridGraph describe', () => {
  it('islands: the scan finds land, counts an island, then sinks it cell by cell', async () => {
    const lines = (await hud(exampleById('islands')!.code)).flat();
    expect(lines.slice(0, 9)).toEqual([
      'probe (0,0): land', 'new island #1', 'probe (0,0): land', 'sink (0,0)', 'probe (1,0): land', 'sink (1,0)',
      'probe (2,0): water', 'probe (0,0): sunk', 'probe (1,1): land',
    ]);
    expect(lines).toContain('probe (-1,1): off the grid');
    expect(lines.filter((l) => l.startsWith('new island'))).toEqual(['new island #1', 'new island #2', 'new island #3']);
    expect(lines.filter((l) => l.startsWith('sink'))).toEqual([
      'sink (0,0)', 'sink (1,0)', 'sink (1,1)', 'sink (0,1)', 'sink (2,2)', 'sink (3,3)', 'sink (3,4)',
    ]);
  });

  it('BFS flood fill: cells filled as they are queued, filled cells found again', async () => {
    const lines = (await hud(FLOOD_FILL_BFS)).flat();
    expect(lines.slice(0, 6)).toEqual([
      'probe (1,1): land', 'fill (1,1)', 'probe (2,1): water', 'probe (0,1): land', 'fill (0,1)', 'probe (1,2): water',
    ]);
    expect(lines).toContain('probe (1,1): filled');
    expect(lines.filter((l) => l.startsWith('fill'))).toHaveLength(6);
  });

  it('maze: walls probed, open cells visited in the visited array', async () => {
    const lines = (await hud(MAZE_VISITED)).flat();
    expect(lines.slice(0, 4)).toEqual(['probe (0,0): land', 'visit (0,0)', 'probe (1,0): wall', 'probe (0,1): land']);
    expect(lines.filter((l) => l.startsWith('visit'))).toHaveLength(6);
  });

  it('BFS distances: a cell is visited as its distance is stored; the store\'s own reads are not probes', async () => {
    const lines = (await hud(HEAD_INDEX_BFS)).flat();
    expect(lines.slice(0, 4)).toEqual(['visit (0,0)', 'probe (1,0): wall', 'probe (0,1): land', 'visit (0,1)']);
    expect(lines.filter((l) => l.startsWith('visit'))).toHaveLength(7);
  });

  it('BFS islands with a visited Set: each island counted before its BFS run', async () => {
    const blocks = await hud(ISLANDS_BFS_SET);
    expect(blocks.slice(0, 3)).toEqual([['probe (0,0): land'], ['new island #1'], ['visit (0,0)']]);
    const lines = blocks.flat();
    expect(lines.filter((l) => l.startsWith('new island'))).toEqual(['new island #1', 'new island #2', 'new island #3']);
    expect(lines).toContain('probe (0,0): visited');
  });
});
