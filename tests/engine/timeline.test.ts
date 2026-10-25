import { describe, expect, it } from 'vitest';
import { lastStep, timelineOf, valueOf, varsAt } from '../helpers/timeline';

const LOOP_SUM = `let sum = 0;
for (let i = 0; i < 5; i++) {
  sum += i;
}`;

describe('timeline: snapshots and diffs', () => {
  it('has one snapshot per step plus the start state', async () => {
    const tl = await timelineOf(LOOP_SUM);
    expect(tl.steps).toHaveLength(20); // step 0 (start) + 19
    expect(tl.snapshots).toHaveLength(20);
    expect(tl.diffs).toHaveLength(20);
    expect(tl.steps[0].kind).toBe('start');
    expect(tl.status).toBe('ok');
  });

  it('shows variables after each step, with loop variables going out of scope after the loop', async () => {
    const tl = await timelineOf(LOOP_SUM);
    expect(varsAt(tl, 0)).toEqual({});
    expect(varsAt(tl, 1)).toEqual({ sum: '0' });
    expect(varsAt(tl, 2)).toEqual({ sum: '0', i: '0' });
    expect(varsAt(tl, 16)).toEqual({ sum: '10', i: '4' });
    expect(varsAt(tl, 18)).toEqual({ sum: '10', i: '5' }); // final failed check: loop still active
    expect(varsAt(tl, 19)).toEqual({ sum: '10' }); // after the loop: i is out of scope
  });

  it('records old → new for every change, including assigned-but-unchanged', async () => {
    const tl = await timelineOf(LOOP_SUM);
    const sumBid = tl.meta.bindings.find((b) => b.name === 'sum')?.id;
    const changes = tl.diffs.flatMap((d, step) => d.vars.filter((v) => v.bid === sumBid).map((v) => ({ step, ...v })));
    expect(changes.map((c) => [c.step, c.kind, c.old, c.value])).toEqual([
      [1, 'new', undefined, 0],
      [4, 'same', 0, 0],
      [7, 'changed', 0, 1],
      [10, 'changed', 1, 3],
      [13, 'changed', 3, 6],
      [16, 'changed', 6, 10],
    ]);
  });

  it('is fully random access in both directions', async () => {
    const tl = await timelineOf(LOOP_SUM);
    const forward = tl.snapshots.map((_, i) => JSON.stringify(varsAt(tl, i)));
    const backward = [...tl.snapshots.keys()].reverse().map((i) => JSON.stringify(varsAt(tl, i))).reverse();
    expect(backward).toEqual(forward);
  });

  it('folds heap mutations into the same state the program sees', async () => {
    const tl = await timelineOf(`const arr = [5, 1, 4];
arr.push(9); arr.unshift(0); arr.shift(); arr.pop(); arr.splice(1, 1, 7, 8); arr.sort((a, b) => a - b); arr.reverse();
const m = new Map(); m.set('a', 1); m.set('b', [1]); m.get('b').push(2); m.delete('a');
const s = new Set([3]); s.add(4); s.delete(3);
const grid = Array.from({ length: 2 }, () => new Array(3).fill(0)); grid[1][2] = 5;
const o = { x: 1 }; o.y = 2; delete o.x;
console.log('done');`);
    const end = lastStep(tl);
    expect(valueOf(tl, end, 'arr')).toEqual([8, 7, 5, 4]);
    expect(valueOf(tl, end, 'm')).toEqual(new Map([['b', [1, 2]]]));
    expect(valueOf(tl, end, 's')).toEqual(new Set([4]));
    expect(valueOf(tl, end, 'grid')).toEqual([[0, 0, 0], [0, 0, 5]]);
    expect(valueOf(tl, end, 'o')).toEqual({ y: 2 });
  });

  it('builds the call tree with return values and exit steps', async () => {
    const tl = await timelineOf(`function fib(n) { if (n <= 1) return n; return fib(n - 1) + fib(n - 2); }
console.log(fib(4));`);
    const nodes = [...tl.calls.values()];
    expect(nodes).toHaveLength(9);
    const root = nodes.find((n) => n.parentId === 0);
    expect(root?.value).toBe(3);
    expect(root?.children).toHaveLength(2);
    for (const n of nodes) {
      expect(n.returnStep).toBeGreaterThan(n.enterStep);
      expect(n.exitStep).toBeGreaterThan(n.returnStep ?? 0);
    }
    expect(tl.logs.map((l) => l.text)).toEqual(['3']);
  });

  it('keeps a closure frame updated after its function returned', async () => {
    const tl = await timelineOf(`function counter() { let c = 0; return () => { c++; return c; }; }
const inc = counter(); inc(); inc();`);
    const end = lastStep(tl);
    const detached = [...tl.snapshots[end].detached.values()];
    expect(detached).toHaveLength(1);
    const cBid = tl.meta.bindings.find((b) => b.name === 'c')?.id as number;
    expect(detached[0].vars.get(cBid)?.v).toBe(2);
  });

  it('marks the uncaught error and keeps the trace playable up to it', async () => {
    const tl = await timelineOf(`let a = 1;\nlet b = null;\nconsole.log(b.x);`);
    expect(tl.status).toBe('error');
    expect(tl.errors).toHaveLength(1);
    expect(tl.errors[0]).toMatchObject({ uncaught: true });
    expect(tl.steps[tl.errors[0].step].line).toBe(3);
  });
});
