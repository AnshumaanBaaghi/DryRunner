/** Queue HUD lines per step, the plugin contract, and where the queue lands among all registered plugins. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { queueVisualizer } from '../../../src/visualizers/queue';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import { timelineOf } from '../../helpers/timeline';
import { DEQUE, HEAD_INDEX, SORT_POP } from './cases';

/** Every HUD line of the run, in order (each step says at most one thing in these programs). */
async function hud(source: string): Promise<string[]> {
  const tl = await timelineOf(source);
  const [d] = queueVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  const blocks = tl.steps.map((_, i) => queueVisualizer.describe!(tl, i, d)).filter((lines) => lines.length);
  expect(queueVisualizer.describe!(tl, 0, d)).toEqual([]);
  expect(blocks.every((lines) => lines.length === 1)).toBe(true);
  return blocks.flat();
}

const example = (id: string) => exampleById(id)!.code;

describe('queue describe', () => {
  it('queue-simulation: one line per enqueue and dequeue, nothing in between', async () => {
    expect(await hud(example('queue-simulation'))).toEqual([
      "enqueue 'Ana'", "enqueue 'Ben'", "dequeue → 'Ana'", "enqueue 'Cai'", "enqueue 'Dee'", "dequeue → 'Ben'", "dequeue → 'Cai'", "dequeue → 'Dee'",
    ]);
  });

  it('dijkstra: re-sorts, extractions of the minimum and insertions', async () => {
    expect((await hud(example('dijkstra'))).slice(0, 7)).toEqual([
      're-sorted by priority', 'extract min [0, 0]', 'enqueue [4, 1]', 'enqueue [1, 2]', 're-sorted by priority', 'extract min [1, 2]', 'enqueue [3, 1]',
    ]);
  });

  it('a max-first priority queue extracts the maximum', async () => {
    expect((await hud(SORT_POP)).slice(0, 3)).toEqual(['re-sorted by priority', 'extract max 8', 'extract max 7']);
  });

  it('deque lines name the end', async () => {
    expect((await hud(DEQUE)).slice(0, 7)).toEqual([
      'push back 0', 'pop back → 0', 'push back 1', 'push back 2', 'push back 3', 'pop front → 1', 'pop back → 3',
    ]);
  });

  it('a head-index queue dequeues as head advances', async () => {
    expect((await hud(HEAD_INDEX)).slice(0, 5)).toEqual(['dequeue → 0', 'enqueue 1', 'enqueue 2', 'dequeue → 1', 'enqueue 3']);
  });

  it('names class instances by the field they are known by', async () => {
    expect((await hud(example('bst-traversals'))).slice(0, 3)).toEqual(['dequeue → TreeNode(8)', 'enqueue TreeNode(3)', 'enqueue TreeNode(10)']);
  });
});

describe('queue plugin', () => {
  it('is a primary view looking down onto the conveyor, with a lazily loaded component', () => {
    expect(queueVisualizer).toMatchObject({ id: 'queue', label: 'Queue', cameraTilt: 0.35 });
    expect((queueVisualizer.Component as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'));
  });

  const withQueue = () => [...visualizers().filter((v) => v.id !== 'queue'), queueVisualizer];

  it('becomes the primary view of queue-simulation among all registered plugins', async () => {
    const tl = await timelineOf(example('queue-simulation'));
    const [primary] = selectDetections(detectAll(tl, withQueue()).all);
    expect(primary).toMatchObject({ vizId: 'queue', role: 'primary', title: 'queue', mode: 'fifo' });
  });

  it.each([['bfs', 'fifo'], ['dijkstra', 'priority'], ['bst-traversals', 'fifo']])('is shown for %s', async (id, mode) => {
    const tl = await timelineOf(example(id));
    const active = selectDetections(detectAll(tl, withQueue()).all);
    expect(active.find((d) => d.vizId === 'queue')?.mode).toBe(mode);
  });
});
