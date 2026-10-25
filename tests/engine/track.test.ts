/** Tracking a variable's value across the trace. */
import { describe, expect, it } from 'vitest';
import { bindingRef } from '../../src/engine/detect/analysis';
import { valueAt } from '../../src/engine/detect/track';
import { timelineOf } from '../helpers/timeline';

describe('trackVar', () => {
  it('follows the loop in scope when a function declares the same name in several loops', async () => {
    const tl = await timelineOf(`const a = [0, 0, 0];
for (let i = 0; i < 2; i++) a[i] = 1;
for (let i = 2; i >= 0; i--) a[i] = 2;`);
    const bid = tl.meta.bindings.find((b) => b.name === 'i')!.id;
    const ref = bindingRef(tl, bid);
    expect(ref.bids).toHaveLength(2);
    const writes = tl.steps.flatMap((s, k) => (s.line === 3 && tl.diffs[k].heap.some((h) => h.op === 'set') ? [k] : []));
    expect(writes.map((k) => valueAt(tl, ref, k))).toEqual([2, 1, 0]);
    const first = tl.steps.flatMap((s, k) => (s.line === 2 && tl.diffs[k].heap.some((h) => h.op === 'set') ? [k] : []));
    expect(first.map((k) => valueAt(tl, ref, k))).toEqual([0, 1]);
  });

  it('shows the current call’s value in recursion and keeps the last value after the function ends', async () => {
    const tl = await timelineOf('function f(n) {\n  if (n === 0) return 0;\n  return f(n - 1);\n}\nf(2);\nconst done = 1;');
    const ref = bindingRef(tl, tl.meta.bindings.find((b) => b.name === 'n')!.id);
    const calls = tl.steps.flatMap((s, k) => (s.kind === 'call' ? [k] : []));
    expect(calls.map((k) => valueAt(tl, ref, k))).toEqual([2, 1, 0]);
    expect(valueAt(tl, ref, tl.steps.length - 1)).toBe(2);
  });
});
