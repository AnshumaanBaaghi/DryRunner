/** Queue detector: FIFO / deque / priority modes, head-index and class-based queues, and what is not a queue. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { detectQueues, isPriorityQueue, QUEUE_SCORE, type QueueBindings } from '../../../src/visualizers/queue/detect';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import { CLASS_QUEUE, DEQUE, HEAD_INDEX, NOT_QUEUE, SORT_POP, UNSHIFT_POP } from './cases';

async function queues(source: string): Promise<Detection<QueueBindings>[]> {
  const tl = await timelineOf(source);
  return detectQueues({ tl, analysis: analyzeTrace(tl) });
}

const example = (id: string) => exampleById(id)!.code;
const summary = (d: Detection<QueueBindings>) => `${d.mode}:${d.title}`;

describe('queue detection', () => {
  it('queue-simulation: a FIFO of names pushed and shifted', async () => {
    const [d, ...rest] = await queues(example('queue-simulation'));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ vizId: 'queue', key: 'queue:0:queue', title: 'queue', mode: 'fifo', score: QUEUE_SCORE, role: 'primary' });
    expect(d.bindings).toMatchObject({ mode: 'fifo', target: { name: 'queue', fnId: 0 } });
    expect(d.bindings.head).toBeUndefined();
    expect(d.claims).toEqual(expect.arrayContaining(['0:queue', `obj:${d.bindings.objId}`]));
  });

  it.each([['bfs', 'queue'], ['bst-traversals', 'queue']])('%s: the BFS frontier is a FIFO', async (id, name) => {
    expect((await queues(example(id))).map(summary)).toEqual([`fifo:${name}`]);
  });

  it('dijkstra: re-sorting before every shift makes a priority queue', async () => {
    const [d, ...rest] = await queues(example('dijkstra'));
    expect(rest).toEqual([]);
    expect(summary(d)).toBe('priority:pq');
    expect(d.bindings.frontAtEnd).toBeUndefined();
  });

  it('extracting a re-sorted array with pop puts the front at its end', async () => {
    const [d] = await queues(SORT_POP);
    expect(summary(d)).toBe('priority:pq');
    expect(d.bindings.frontAtEnd).toBe(true);
  });

  it('a monotonic deque uses both ends', async () => {
    expect((await queues(DEQUE)).map(summary)).toEqual(['deque:dq']);
  });

  it('unshift + pop is a FIFO drained from the array end', async () => {
    const [d] = await queues(UNSHIFT_POP);
    expect(summary(d)).toBe('fifo:line');
    expect(d.bindings.frontAtEnd).toBe(true);
  });

  it('reading queue[head++] while pushing is a FIFO with a head pointer', async () => {
    const [d, ...rest] = await queues(HEAD_INDEX);
    expect(rest).toEqual([]);
    expect(summary(d)).toBe('fifo:queue');
    expect(d.bindings.head?.name).toBe('head');
  });

  it('a class whose methods enqueue / dequeue is shown by its instance', async () => {
    const [d, ...rest] = await queues(CLASS_QUEUE);
    expect(rest).toEqual([]);
    expect(summary(d)).toBe('fifo:q');
    expect(d.bindings).toMatchObject({ target: { name: 'q' }, prop: 'items' });
    // the instance and its items array are both claimed
    expect(d.claims.filter((c) => c.startsWith('obj:'))).toHaveLength(2);
  });

  it('an object property queue without queue methods is titled by its path', async () => {
    const [d] = await queues('const state = { queue: [1, 2] };\nstate.queue.push(3);\nstate.queue.shift();\nstate.queue.shift();');
    expect(summary(d)).toBe('fifo:state.queue');
  });

  it('a function run twice shows one queue for its variable', async () => {
    const ds = await queues('function drain(xs) {\n  const q = [];\n  for (const x of xs) q.push(x);\n  while (q.length) q.shift();\n}\ndrain([1, 2]);\ndrain([3]);');
    expect(ds.map(summary)).toEqual(['fifo:q']);
    expect(ds[0].claims.filter((c) => c.startsWith('obj:'))).toHaveLength(2);
  });

  it('sorting once and draining is not a priority queue', async () => {
    const ds = await queues('const a = [3, 1, 2];\na.sort((x, y) => x - y);\nwhile (a.length) a.shift();\na.push(4);');
    expect(ds.map(summary)).toEqual(['fifo:a']);
  });

  it.each(NOT_QUEUE)('finds no queue in %s', async (id) => {
    expect(await queues(example(id))).toEqual([]);
  });

  it('tells other detectors which arrays are priority queues rather than sorting arrays', async () => {
    const pq = async (source: string, name: string) => {
      const tl = await timelineOf(source);
      const info = [...analyzeTrace(tl).vars.values()].find((v) => v.ref.name === name)!;
      return isPriorityQueue(tl, [...info.heapIds][0]);
    };
    expect(await pq(example('dijkstra'), 'pq')).toBe(true);
    expect(await pq(SORT_POP, 'pq')).toBe(true);
    expect(await pq(example('bubble-sort'), 'arr')).toBe(false);
    expect(await pq(example('queue-simulation'), 'queue')).toBe(false);
  });

  it('stacks are not queues, whichever end they use', async () => {
    expect(await queues('const s = [];\ns.push(1);\ns.push(2);\ns.pop();')).toEqual([]);
    expect(await queues('const s = [];\ns.unshift(1);\ns.unshift(2);\ns.shift();')).toEqual([]);
  });
});
