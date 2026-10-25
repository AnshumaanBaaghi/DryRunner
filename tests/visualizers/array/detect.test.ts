/** Array detector: which variables become pointers, windows, intervals, and which mode wins. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { detectArrays, type ArrayBindings } from '../../../src/visualizers/array/detect';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

async function arrays(source: string): Promise<Detection<ArrayBindings>[]> {
  const tl = await timelineOf(source);
  return detectArrays({ tl, analysis: analyzeTrace(tl) });
}

const example = (id: string) => exampleById(id)!.code;
const roles = (d: Detection<ArrayBindings>) => d.bindings.pointers.map((p) => `${p.role}:${p.ref.name}`);

describe('array detection', () => {
  it('finds a sliding window whose left edge never indexes the string', async () => {
    const [d, ...rest] = await arrays(example('longest-substring'));
    expect(rest).toHaveLength(0);
    expect(d.mode).toBe('window');
    expect(d.title).toBe('s');
    expect(d.bindings.isString).toBe(true);
    expect(d.bindings.window?.left.name).toBe('left');
    expect(d.bindings.window?.right.name).toBe('right');
    expect(roles(d)).toEqual(['left:left', 'right:right']);
  });

  it('recognizes converging two pointers and the span they leave', async () => {
    const [d] = await arrays(example('two-sum-sorted'));
    expect(d.mode).toBe('two-pointers');
    expect(roles(d)).toEqual(['left:left', 'right:right']);
    expect(d.bindings.span?.left.name).toBe('left');
    expect(d.bindings.span?.right.name).toBe('right');
  });

  it('recognizes binary search from the mid index and the lo / hi bounds', async () => {
    const [d] = await arrays(example('binary-search'));
    expect(d.mode).toBe('binary-search');
    expect(d.bindings.interval?.lo.name).toBe('lo');
    expect(d.bindings.interval?.hi.name).toBe('hi');
    expect(d.bindings.interval?.mid?.name).toBe('mid');
    expect(roles(d)).toEqual(['lo:lo', 'hi:hi', 'mid:mid']);
  });

  it.each(['bubble-sort', 'quick-sort'])('recognizes in-place sorting (%s)', async (id) => {
    const [d] = await arrays(example(id));
    expect(d.mode).toBe('sorting');
    expect(d.title).toBe('arr');
    expect(d.score).toBeGreaterThanOrEqual(0.9);
  });

  it('lets nested loop counters over a read-only array yield to the iteration space', async () => {
    const [d] = await arrays(example('nested-pairs'));
    expect(d.mode).toBe('pointers');
    expect(d.score).toBeLessThan(0.2);
  });

  it('does not mistake resetting inner-loop counters for a window', async () => {
    const [d] = await arrays(`const a = [4, 1, 3, 2];
let best = 0;
for (let i = 0; i < a.length; i++) {
  for (let j = i; j < a.length; j++) best = Math.max(best, a[j] - a[i]);
}`);
    expect(d.mode).not.toBe('window');
  });

  it('shows plain indexing with its index variable', async () => {
    const [d] = await arrays('const a = [3, 1, 2];\nfor (let k = 0; k < a.length; k++) {\n  a[k] = a[k] * 2;\n}');
    expect(d.mode).toBe('pointers');
    expect(roles(d)).toEqual(['pointer:k']);
  });

  it('ignores arrays that are neither indexed nor written', async () => {
    expect(await arrays('const xs = [1, 2, 3];\nconst total = xs.reduce((s, x) => s + x, 0);\nconsole.log(total);')).toEqual([]);
  });
});

describe('array detection next to other structures', () => {
  it('leaves a re-sorted priority queue of numbers to the queue view', async () => {
    const found = await arrays(`const pq = [5, 3];
pq.push(4);
pq.sort((a, b) => b - a);
const top = pq.pop();
pq.push(1);
pq.sort((a, b) => b - a);
pq.pop();`);
    expect(found).toEqual([]);
  });
});
