/** Graph HUD lines per step, and the plugin contract. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { graphVisualizer } from '../../../src/visualizers/graph';
import { timelineOf } from '../../helpers/timeline';
import { BELLMAN, example, MAP_BFS, STACK_DFS } from './cases';

/** Every HUD line of the run, in order. */
async function hud(source: string): Promise<string[]> {
  const tl = await timelineOf(source);
  const [d] = graphVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  expect(graphVisualizer.describe!(tl, 0, d)).toEqual([]);
  return tl.steps.flatMap((_, i) => graphVisualizer.describe!(tl, i, d));
}

describe('graph describe', () => {
  it('bfs: the graph, each expansion and each edge looked at, by what the visited check finds', async () => {
    expect(await hud(example('bfs'))).toEqual([
      'graph: 6 nodes · 7 edges',
      'expand 0', 'edge 0 → 1: new', 'edge 0 → 2: new',
      'expand 1', 'edge 1 → 0: already visited', 'edge 1 → 3: new', 'edge 1 → 4: new',
      'expand 2', 'edge 2 → 0: already visited', 'edge 2 → 4: already visited',
      'expand 3', 'edge 3 → 1: already visited', 'edge 3 → 5: new',
      'expand 4', 'edge 4 → 1: already visited', 'edge 4 → 2: already visited', 'edge 4 → 5: already visited',
      'expand 5', 'edge 5 → 3: already visited', 'edge 5 → 4: already visited',
    ]);
  });

  it('dfs: calls expand, returns go back to the caller', async () => {
    expect(await hud(example('dfs'))).toEqual([
      'graph: 6 nodes · 6 edges',
      'expand A', 'edge A → B: new', 'expand B', 'edge B → D: new', 'expand D', 'back to B', 'edge B → E: new', 'expand E', 'edge E → F: new',
      'expand F', 'back to E', 'back to B', 'back to A', 'edge A → C: new', 'expand C', 'edge C → F: already visited', 'back to A',
    ]);
  });

  it('dijkstra: the adjacency built edge by edge, weights, queue membership, relaxations, stale entries', async () => {
    const lines = await hud(example('dijkstra'));
    expect(lines.slice(0, 3)).toEqual(['add edge 0 → 1', 'add edge 1 → 0', 'add edge 0 → 2']);
    const search = lines.slice(lines.indexOf('relax 0: ∞ → 0'));
    expect(search.slice(0, 13)).toEqual([
      'relax 0: ∞ → 0', 'expand 0', 'edge 0 → 1 (w=4): new', 'relax 1: ∞ → 4', 'edge 0 → 2 (w=1): new', 'relax 2: ∞ → 1',
      'expand 2', 'edge 2 → 0 (w=1): already visited', 'edge 2 → 1 (w=2): in the queue', 'relax 1: 4 → 3', 'edge 2 → 3 (w=5): new', 'relax 3: ∞ → 6',
      'expand 1',
    ]);
    // lazy deletion: the outdated entries come out of the queue again
    expect(lines.filter((l) => l.endsWith(' again'))).toEqual(['expand 1 again', 'expand 3 again']);
  });

  it('Bellman-Ford over an edge list: one line per edge looked at, and its relaxation', async () => {
    expect((await hud(BELLMAN)).slice(0, 10)).toEqual([
      'graph: 4 nodes · 4 edges', 'relax 0: ∞ → 0', 'edge 0 → 1 (w=4)', 'relax 1: ∞ → 4', 'edge 0 → 2 (w=1)', 'relax 2: ∞ → 1',
      'edge 2 → 1 (w=2)', 'relax 1: 4 → 3', 'edge 1 → 3 (w=1)', 'relax 3: ∞ → 4',
    ]);
  });

  it('a frontier stack, and edges added one by one to a Map', async () => {
    expect((await hud(STACK_DFS)).slice(0, 4)).toEqual(['graph: 6 nodes · 7 edges', 'expand 0', 'edge 0 → 1: new', 'edge 0 → 2: new']);
    expect((await hud(MAP_BFS)).slice(0, 4)).toEqual(['add edge a → b', 'add edge b → a', 'add edge a → c', 'add edge c → a']);
  });
});

describe('graph plugin', () => {
  it('is the primary "Graph" view, seen a little from above', () => {
    expect(graphVisualizer).toMatchObject({ id: 'graph', label: 'Graph', cameraTilt: 0.3 });
    expect(typeof graphVisualizer.Component).toBe('object');
  });
});
