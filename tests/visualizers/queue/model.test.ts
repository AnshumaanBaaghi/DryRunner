/** Per-step queue model: items front → rear with stable identities, arrivals and departures (and their reversal), priorities. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { detectQueues, type QueueBindings } from '../../../src/visualizers/queue/detect';
import { buildQueueModel, xOf, type QueueModel } from '../../../src/visualizers/queue/model';
import { timelineOf, valueOf } from '../../helpers/timeline';
import { CLASS_QUEUE, DEQUE, HEAD_INDEX, SORT_POP, UNSHIFT_POP } from './cases';

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** at step i, having stepped back from i + 1 */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });

async function setup(source: string): Promise<{ tl: Timeline; b: QueueBindings; at: (i: number, hl?: Highlight | null) => QueueModel }> {
  const tl = await timelineOf(source);
  const [d] = detectQueues({ tl, analysis: analyzeTrace(tl) });
  return { tl, b: d.bindings, at: (i, hl = null) => buildQueueModel(tl, i, d.bindings, hl) };
}

const labels = (m: QueueModel) => m.items.map((it) => it.label);
/** first step whose diff changes the array with `op` (and `args[0]` / `old` equal to `value` when given) */
const stepOf = (tl: Timeline, op: string, value?: unknown) => tl.diffs.findIndex((d) => d.heap.some((h) => h.op === op
  && (value === undefined || h.args?.[0] === value || h.old === value)));

describe('queue model', () => {
  it('lists the items front → rear at every step on a conveyor as long as the longest queue', async () => {
    const { tl, at } = await setup(exampleById('queue-simulation')!.code);
    let checked = 0;
    for (let i = 0; i < tl.steps.length; i++) {
      const queue = valueOf(tl, i, 'queue');
      const m = at(i);
      expect(m.maxLen).toBe(3);
      if (!Array.isArray(queue)) {
        expect(m.exists).toBe(false);
        continue;
      }
      expect(labels(m)).toEqual(queue.map((name) => `'${name}'`));
      expect(m.items.map((it) => it.x)).toEqual(m.items.map((_, slot) => xOf(slot, 3)));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('an enqueue slides in at the rear; stepping back over it slides it out again', async () => {
    const { tl, at } = await setup(exampleById('queue-simulation')!.code);
    const i = stepOf(tl, 'push', 'Ben');
    const m = at(i, forward(tl, i));
    expect(m.items.map((it) => `${it.label}:${it.enter}`)).toEqual(["'Ana':null", "'Ben':rear"]);
    expect(m.leaving).toEqual([]);
    expect(m.focusX).toBe(m.items[1].x);
    const back = at(i - 1, backward(tl, i - 1));
    expect(back.items.map((it) => `${it.label}:${it.enter}`)).toEqual(["'Ana':null"]);
    expect(back.leaving).toMatchObject([{ label: "'Ben'", exit: 'rear', slot: 1, key: m.items[1].key }]);
  });

  it('a dequeue slides the front out while the rest glide forward; stepping back brings it in at the front', async () => {
    const { tl, at } = await setup(exampleById('queue-simulation')!.code);
    const i = stepOf(tl, 'shift', 'Ana');
    const before = at(i - 1);
    const m = at(i, forward(tl, i));
    expect(m.leaving).toMatchObject([{ label: "'Ana'", exit: 'front', slot: 0, key: before.items[0].key }]);
    expect(m.items).toMatchObject([{ label: "'Ben'", slot: 0, key: before.items[1].key, enter: null }]);
    expect(m.focusX).toBe(before.items[0].x);
    const back = at(i - 1, backward(tl, i - 1));
    expect(back.items.map((it) => `${it.label}:${it.enter}`)).toEqual(["'Ana':front", "'Ben':null"]);
    expect(back.leaving).toEqual([]);
  });

  it('moves nothing without a highlight; focuses only steps that change the queue', async () => {
    const { tl, b, at } = await setup(exampleById('queue-simulation')!.code);
    for (let i = 0; i < tl.steps.length; i++) {
      const plain = at(i);
      expect(plain.items.every((it) => it.enter === null) && plain.leaving.length === 0).toBe(true);
      const touched = tl.diffs[i].heap.some((h) => h.id === b.objId && h.op !== 'alloc');
      expect(at(i, forward(tl, i)).focusX === null).toBe(!touched);
    }
  });

  it('a priority queue shows "priority · value", glows the best item and re-sorts identities', async () => {
    const { tl, at } = await setup(exampleById('dijkstra')!.code);
    const i = tl.diffs.findIndex((d) => d.heap.some((h) => h.op === 'sort' && h.perm?.[0] === 1));
    const before = at(i - 1);
    expect(before.items.map((it) => `${it.label}:${it.priority}:${it.next}`)).toEqual(['4 · 1:4:false', '1 · 2:1:true']);
    const m = at(i, forward(tl, i));
    expect(m.resorted).toBe(true);
    expect(m.items.map((it) => it.key)).toEqual([before.items[1].key, before.items[0].key]);
    expect(m.items.map((it) => `${it.label}:${it.next}`)).toEqual(['1 · 2:true', '4 · 1:false']);
    expect(m.focusX).toBe(m.items[0].x);
    const extracted = at(i + 1, forward(tl, i + 1));
    expect(extracted.leaving).toMatchObject([{ label: '1 · 2', exit: 'front', next: true }]);
  });

  it.each([['dijkstra', exampleById('dijkstra')!.code], ['sort + pop', SORT_POP]])(
    '%s: the item marked next is the one extracted next',
    async (_, source) => {
      const { tl, at } = await setup(source);
      let checked = 0;
      for (let i = 1; i < tl.steps.length; i++) {
        const m = at(i, forward(tl, i));
        if (!m.leaving.length || m.leaving[0].exit !== 'front') continue;
        expect(at(i - 1).items.find((it) => it.next)?.key).toBe(m.leaving[0].key);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(4);
    },
  );

  it('a head-index queue shows elems[head..] and dequeues by advancing head', async () => {
    const { tl, b, at } = await setup(HEAD_INDEX);
    let checked = 0;
    for (let i = 0; i < tl.steps.length; i++) {
      const queue = valueOf(tl, i, 'queue');
      const head = valueOf(tl, i, 'head');
      if (!Array.isArray(queue) || typeof head !== 'number') continue;
      expect(labels(at(i))).toEqual(queue.slice(head).map(String));
      expect(at(i).headIndex).toBe(head);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
    const i = tl.diffs.findIndex((d) => d.vars.some((c) => b.head!.bids.includes(c.bid) && c.value === 2));
    const m = at(i, forward(tl, i));
    expect(m.leaving).toMatchObject([{ label: '1', exit: 'front', slot: 0 }]);
    expect(at(i - 1, backward(tl, i - 1)).items[0]).toMatchObject({ label: '1', enter: 'front' });
  });

  it('a queue filled with unshift is drawn front-first from the array end', async () => {
    const { tl, at } = await setup(UNSHIFT_POP);
    const i = stepOf(tl, 'unshift', 3);
    expect(at(i, forward(tl, i)).items.map((it) => `${it.label}:${it.enter}`)).toEqual(['1:null', '2:null', '3:rear']);
    const j = stepOf(tl, 'pop');
    expect(at(j, forward(tl, j))).toMatchObject({ items: [{ label: '2' }, { label: '3' }], leaving: [{ label: '1', exit: 'front' }] });
  });

  it('a deque loses items through the end they are taken from', async () => {
    const { tl, at } = await setup(DEQUE);
    const pop = stepOf(tl, 'pop');
    const shift = stepOf(tl, 'shift');
    expect(at(pop, forward(tl, pop)).leaving.map((it) => it.exit)).toEqual(['rear']);
    expect(at(shift, forward(tl, shift)).leaving.map((it) => it.exit)).toEqual(['front']);
  });

  it('a class-based queue is read through its instance', async () => {
    const { tl, at } = await setup(CLASS_QUEUE);
    expect(at(1).exists).toBe(false);
    expect(labels(at(tl.steps.length - 1))).toEqual(['3']);
    const i = stepOf(tl, 'shift', 1);
    expect(at(i, forward(tl, i))).toMatchObject({ items: [{ label: '2' }], leaving: [{ label: '1', exit: 'front' }] });
  });
});
