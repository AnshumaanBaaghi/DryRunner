/** Stack detector: which arrays are stacks, which are monotonic, and what the stage shows next to the other plugins. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import { stackVisualizer } from '../../../src/visualizers/stack';
import { timelineOf } from '../../helpers/timeline';

const detect = (tl: Timeline) => stackVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
const stacks = async (source: string) => detect(await timelineOf(source));
const example = (id: string) => exampleById(id)!.code;

/** What the stage shows with every registered plugin and this one. */
async function stage(id: string) {
  const plugins = visualizers().some((p) => p.id === 'stack') ? visualizers() : [...visualizers(), stackVisualizer];
  return selectDetections(detectAll(await timelineOf(example(id)), plugins).all);
}

describe('stack detection', () => {
  it('recognizes the stack of valid parentheses (no mode)', async () => {
    const [d, ...rest] = await stacks(example('valid-parentheses'));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ vizId: 'stack', key: 'stack:1:stack', title: 'stack', score: 0.85, role: 'primary' });
    expect(d.mode).toBeUndefined();
    expect(d.bindings.monotonic).toBeUndefined();
    expect(d.bindings.target).toMatchObject({ name: 'stack', fnId: 1 });
    expect(d.claims).toEqual([`obj:${d.bindings.objId}`, '1:stack']);
  });

  it('recognizes a monotonic stack of indexes, decreasing over the values they index', async () => {
    const [d, ...rest] = await stacks(example('next-greater'));
    expect(rest).toEqual([]);
    expect(d.mode).toBe('monotonic');
    expect(d.bindings.monotonic).toMatchObject({ direction: 'decreasing', values: { name: 'nums', fnId: 1 } });
    expect(d.claims).toEqual([`obj:${d.bindings.objId}`, '1:stack']);
  });

  it.each(['queue-simulation', 'bfs', 'dijkstra', 'bubble-sort', 'two-sum-sorted', 'reverse-list', 'dfs', 'merge-sort', 'quick-sort', 'loop-sum'])(
    'finds no stack in %s',
    async (id) => {
      expect(await stacks(example(id))).toEqual([]);
    },
  );

  it('ignores push-only lists, queues, priority queues and lists that only fill then drain', async () => {
    expect(await stacks('const out = [];\nfor (let i = 0; i < 3; i++) out.push(i * i);')).toEqual([]);
    expect(await stacks('const q = [1];\nq.push(2);\nq.shift();\nq.push(3);\nq.pop();\nq.push(4);')).toEqual([]);
    expect(await stacks(`const pq = [];
for (const x of [5, 1, 4]) {
  pq.push(x);
  pq.sort((a, b) => b - a);
}
const a = pq.pop();
pq.push(3);
const b = pq.pop();`)).toEqual([]);
    expect(await stacks("const s = [];\nfor (const c of 'abc') s.push(c);\nlet out = '';\nwhile (s.length) out += s.pop();")).toEqual([]);
  });

  it('counts a peek at the top between the pushes and the pops', async () => {
    const [d] = await stacks("const s = [];\nfor (const c of 'abc') s.push(c);\nconst top = s[s.length - 1];\nwhile (s.length) s.pop();");
    expect(d).toMatchObject({ vizId: 'stack', title: 's' });
  });

  it('keeps plain mode when pops do not make room for the next element (DFS order, RPN operands)', async () => {
    const [dfs] = await stacks(`const kids = (n) => (n < 3 ? [2 * n + 1, 2 * n + 2] : []);
const stack = [0];
while (stack.length) {
  const n = stack.pop();
  for (const c of kids(n)) stack.push(c);
}`);
    expect(dfs.mode).toBeUndefined();
    const [rpn] = await stacks(`const stack = [];
for (const t of ['2', '1', '+', '3', '*', '4', '+']) {
  if (t === '+' || t === '*') {
    const b = stack.pop();
    const a = stack.pop();
    stack.push(t === '+' ? a + b : a * b);
  } else stack.push(Number(t));
}`);
    expect(rpn.mode).toBeUndefined();
  });

  it('finds the monotonic direction of indexes (skipping a -1 sentinel), plain values and strings', async () => {
    const [daily] = await stacks(`function daily(temps) {
  const answer = new Array(temps.length).fill(0);
  const stack = [];
  for (let i = 0; i < temps.length; i++) {
    while (stack.length && temps[stack[stack.length - 1]] < temps[i]) {
      const j = stack.pop();
      answer[j] = i - j;
    }
    stack.push(i);
  }
  return answer;
}
daily([73, 74, 75, 71, 69, 72, 76, 73]);`);
    expect(daily.bindings.monotonic).toMatchObject({ direction: 'decreasing', values: { name: 'temps' } });
    const [histogram] = await stacks(`function largest(heights) {
  const stack = [-1];
  let best = 0;
  for (let i = 0; i < heights.length; i++) {
    while (stack[stack.length - 1] !== -1 && heights[stack[stack.length - 1]] >= heights[i]) {
      const h = heights[stack.pop()];
      best = Math.max(best, h * (i - stack[stack.length - 1] - 1));
    }
    stack.push(i);
  }
  return best;
}
largest([2, 1, 5, 6, 2, 3]);`);
    expect(histogram.bindings.monotonic).toMatchObject({ direction: 'increasing', values: { name: 'heights' } });
    const [byValue] = await stacks(`const next = new Map();
const stack = [];
for (const x of [4, 1, 2, 5, 3, 6]) {
  while (stack.length && stack[stack.length - 1] < x) next.set(stack.pop(), x);
  stack.push(x);
}`);
    expect(byValue.bindings.monotonic).toEqual({ direction: 'decreasing' });
    const [letters] = await stacks(`const stack = [];
for (const c of 'dbcaef') {
  while (stack.length && stack[stack.length - 1] > c) stack.pop();
  stack.push(c);
}`);
    expect(letters.bindings.monotonic).toEqual({ direction: 'increasing' });
  });

  it('keeps one detection per variable when calls build new stacks, claiming every array it holds', async () => {
    const tl = await timelineOf(`function balanced(s) {
  const stack = [];
  for (const ch of s) {
    if (ch === '(') stack.push(ch);
    else if (!stack.length || stack.pop() !== '(') return false;
  }
  return stack.length === 0;
}
balanced('(())');
balanced('()()');`);
    const [d, ...rest] = detect(tl);
    expect(rest).toEqual([]);
    const ids = [...analyzeTrace(tl).vars.get('1:stack')!.heapIds];
    expect(ids).toHaveLength(2);
    // the first call only fills then drains its stack: the second one makes the variable a stack
    expect(d.bindings.objId).toBe(ids[1]);
    expect(d.claims.sort()).toEqual(['1:stack', ...ids.map((id) => `obj:${id}`)].sort());
  });

  it('claims the parameters a helper receives the stack in', async () => {
    const [d] = await stacks(`function pushAll(st, xs) {
  for (const x of xs) st.push(x);
}
const stack = [];
pushAll(stack, [1, 2]);
stack.pop();
pushAll(stack, [3]);`);
    expect(d.bindings.target).toMatchObject({ name: 'stack', fnId: 0 });
    expect(d.claims).toContain('1:st');
  });

  it('lists several stacks busiest first', async () => {
    const ds = await stacks(`const stack = [];
const mins = [];
function push(x) {
  stack.push(x);
  if (!mins.length || x <= mins[mins.length - 1]) mins.push(x);
}
function pop() {
  const x = stack.pop();
  if (x === mins[mins.length - 1]) mins.pop();
  return x;
}
push(5);
push(3);
push(7);
pop();
push(2);
pop();
pop();
push(1);`);
    expect(ds.map((d) => d.title)).toEqual(['stack', 'mins']);
  });
});

describe('stack on the stage', () => {
  it.each(['valid-parentheses', 'next-greater'])('is the primary view (%s)', async (id) => {
    const primary = (await stage(id)).find((d) => d.role === 'primary');
    expect(primary?.vizId).toBe('stack');
    expect(primary?.mode).toBe(exampleById(id)!.expect.mode);
  });

  it.each(['subsets', 'permutations'])('leaves the backtracking path to the backtracking view (%s)', async (id) => {
    const shown = await stage(id);
    expect(shown.find((d) => d.role === 'primary')?.vizId).toBe('backtracking');
    expect(shown.some((d) => d.vizId === 'stack')).toBe(false);
  });
});
