/** Linked-list model: stable slots, links per step, written links (old → new), pointers, and the arcs' geometry. */
import { describe, expect, it } from 'vitest';
import type { Timeline } from '../../../src/engine/timeline/types';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { bandsOf, linkArc, nullStub } from '../../../src/visualizers/linkedList/geometry';
import { chainsOf } from '../../../src/visualizers/linkedList/links';
import { buildListModel, listFrame, MAX_SLOTS, type ListModel } from '../../../src/visualizers/linkedList/model';
import { bySlot, CYCLE, DOUBLY, DUMMY_HEAD, example, PLAIN_OBJECTS, setup } from './cases';

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });
const labels = (m: ListModel) => bySlot(m.nodes).map((n) => n.label);
const nexts = (m: ListModel) => bySlot(m.nodes).map((n) => n.next);
const markers = (m: ListModel) => m.pointers.map((p) => `${p.name}@${p.slot}/${p.stack}`);

/** First step whose diff rewrites an existing `next` link. */
const firstRewrite = (tl: Timeline) => tl.diffs.findIndex((d) => d.heap.some((h) => h.op === 'set' && h.path[0] === 'next' && h.old !== undefined));

describe('linked list slots', () => {
  it('reverse-list: the chain 1 → 2 → 3 → 4 → 5 seen before the reversal gives the slots, for the whole run', async () => {
    const { tl, d } = await setup(example('reverse-list'));
    const last = tl.steps.length - 1;
    const end = buildListModel(tl, last, d.bindings, null);
    expect(labels(end)).toEqual(['1', '2', '3', '4', '5']);
    const slotOf = new Map(end.nodes.map((n) => [n.id, n.slot]));
    for (let i = 0; i <= last; i++) {
      for (const n of buildListModel(tl, i, d.bindings, null).nodes) expect(n.slot).toBe(slotOf.get(n.id));
    }
    expect(listFrame(tl, d.bindings)).toMatchObject({ hidden: 0, nullSlot: 5, slotCount: 6, spanRight: 1, spanLeft: 1, maxStack: 3 });
  });

  it('a dummy head takes the first slot: the longest chain includes it', async () => {
    const { tl, d } = await setup(DUMMY_HEAD);
    const end = buildListModel(tl, tl.steps.length - 1, d.bindings, null);
    expect(labels(end)).toEqual(['0', '1', '6', '2', '6', '3']);
    // the removed 6s still point on; their predecessors skip them
    expect(nexts(end)).toEqual([1, 3, 3, 5, 5, null]);
  });

  it('chains walk from the nodes nothing links to, then around cycles; skipped nodes end them', () => {
    expect(chainsOf([1, 2, 3, 4], new Map([[1, 3], [2, 3], [3, null], [4, null]]))).toEqual([[1, 3], [2, 3], [4]]);
    expect(chainsOf([1, 2, 3, 4], new Map([[1, 2], [2, 3], [3, 4], [4, 2]]))).toEqual([[1, 2, 3, 4]]);
    expect(chainsOf([1, 2, 3], new Map([[1, 2], [2, 3], [3, 1]]))).toEqual([[1, 2, 3]]);
    expect(chainsOf([1, 2, 3], new Map([[1, 2], [2, 3]]), new Set([2]))).toEqual([[1], [3]]);
  });

  it('a cycle keeps its slots and links back to the left', async () => {
    const { tl, d } = await setup(CYCLE);
    const end = buildListModel(tl, tl.steps.length - 1, d.bindings, null);
    expect(labels(end)).toEqual(['1', '2', '3', '4']);
    expect(nexts(end)).toEqual([1, 2, 3, 1]);
    expect(listFrame(tl, d.bindings)).toMatchObject({ spanRight: 1, spanLeft: 2 });
  });

  it('nodes past the slot budget share one overflow slot', async () => {
    const { tl, d } = await setup('let head = null;\nfor (let k = 0; k < 60; k++) head = { val: k, next: head };');
    const frame = listFrame(tl, d.bindings);
    expect(frame).toMatchObject({ hidden: 60 - MAX_SLOTS, nullSlot: MAX_SLOTS + 1, slotCount: MAX_SLOTS + 2 });
    const end = buildListModel(tl, tl.steps.length - 1, d.bindings, null);
    expect(end.nodes).toHaveLength(MAX_SLOTS);
    expect(bySlot(end.nodes).at(-1)).toMatchObject({ slot: MAX_SLOTS - 1, label: '12', next: MAX_SLOTS });
  });
});

describe('linked list model', () => {
  it('reverse-list: links point right before the reversal and left after it', async () => {
    const { tl, d } = await setup(example('reverse-list'));
    const before = buildListModel(tl, firstRewrite(tl) - 1, d.bindings, null);
    expect(nexts(before)).toEqual([1, 2, 3, 4, null]);
    expect(nexts(buildListModel(tl, tl.steps.length - 1, d.bindings, null))).toEqual([null, 0, 1, 2, 3]);
  });

  it('the written link: old → new forward, and new → old while it is being undone', async () => {
    const { tl, d } = await setup(example('reverse-list'));
    // curr.next = prev: node 1 stops pointing at node 2
    const i = firstRewrite(tl);
    const fwd = buildListModel(tl, i, d.bindings, forward(tl, i));
    expect(fwd.changes).toEqual([{ from: 0, key: 'next', now: null, was: 1 }]);
    expect(bySlot(fwd.nodes)[0]).toMatchObject({ next: null, color: COLORS.changed, pulse: true });
    expect(fwd.focusSlot).toBe(0);
    const back = buildListModel(tl, i - 1, d.bindings, backward(tl, i - 1));
    expect(back.changes).toEqual([{ from: 0, key: 'next', now: 1, was: null }]);
    expect(bySlot(back.nodes)[0].next).toBe(1);
  });

  it('a new node appears at its slot and drops in; stepping back over it removes it', async () => {
    const { tl, d } = await setup(example('reverse-list'));
    const i = tl.diffs.findIndex((diff) => diff.heap.some((h) => h.op === 'alloc' && d.bindings.nodeIds.includes(h.id)));
    const fwd = buildListModel(tl, i, d.bindings, forward(tl, i));
    expect(fwd.nodes).toEqual([expect.objectContaining({ label: '5', slot: 4, isNew: true, pulse: true })]);
    expect(fwd.focusSlot).toBe(4);
    expect(buildListModel(tl, i - 1, d.bindings, backward(tl, i - 1)).nodes).toEqual([]);
  });

  it('pointers stack on shared nodes, null ones sit at the null slot, a finished call’s pointers vanish', async () => {
    const { tl, d } = await setup(example('reverse-list'));
    const atStep = (i: number) => buildListModel(tl, i, d.bindings, forward(tl, i));
    // `let curr = head`: both heads (the global and the parameter) show once
    const start = tl.steps.findIndex((_, i) => markers(atStep(i)).includes('curr@0/1'));
    expect(markers(atStep(start))).toEqual(['head@0/0', 'prev@5/0', 'curr@0/1']);
    expect(atStep(start).nullUsed).toBe(true);
    // `prev = curr` in the first iteration
    const moved = tl.steps.findIndex((_, i) => markers(atStep(i)).includes('prev@0/1'));
    expect(markers(atStep(moved))).toEqual(['head@0/0', 'prev@0/1', 'curr@0/2', 'next@1/0']);
    expect(atStep(moved).focusSlot).toBe(0);
    const end = atStep(tl.steps.length - 1);
    expect(markers(end)).toEqual(['head@0/0', 'node@5/0']);
  });

  it('values and the nodes read this step', async () => {
    const { tl, d } = await setup(PLAIN_OBJECTS);
    const i = tl.diffs.findIndex((diff) => diff.reads.some((r) => d.bindings.nodeIds.includes(r.id)));
    const m = buildListModel(tl, i, d.bindings, forward(tl, i));
    expect(labels(m)).toEqual(['1', '2', '3']);
    expect(m.nodes.filter((n) => n.color === COLORS.current)).toHaveLength(1);
  });

  it('a doubly linked list keeps prev links; unlinking a node skips its slot both ways', async () => {
    const { tl, d } = await setup(DOUBLY);
    const end = buildListModel(tl, tl.steps.length - 1, d.bindings, null);
    expect(labels(end)).toEqual(['1', '2', '3', '4']);
    expect(nexts(end)).toEqual([2, 2, 3, null]);
    expect(bySlot(end.nodes).map((n) => n.prev)).toEqual([null, 0, 0, 2]);
    expect(listFrame(tl, d.bindings)).toMatchObject({ spanRight: 2, spanLeft: 2, nullSlot: -1, slotCount: 4 });
    // victim.next.prev = victim.prev: node 3 now points back at node 1
    const i = tl.diffs.findLastIndex((diff) => diff.heap.some((h) => h.path[0] === 'prev'));
    expect(buildListModel(tl, i, d.bindings, forward(tl, i)).changes).toEqual([{ from: 2, key: 'prev', now: 0, was: 1 }]);
  });
});

describe('linked list geometry', () => {
  const rowY = 1.5;

  it('links to the right run over the row (straight to a neighbor), links to the left under it', () => {
    const neighbor = linkArc(1, 2, 'next', 6, rowY);
    expect(neighbor.from[1]).toBe(neighbor.to[1]);
    expect(neighbor.from[0]).toBeLessThan(neighbor.to[0]);
    expect(Math.abs(neighbor.bend)).toBeLessThan(0.2);
    const over = linkArc(1, 3, 'next', 6, rowY);
    expect(over.from[1]).toBeGreaterThan(rowY);
    expect(over.bend).toBeGreaterThan(0);
    const under = linkArc(3, 1, 'next', 6, rowY);
    expect(under.from[1]).toBeLessThan(rowY);
    expect(under.bend).toBeLessThan(0);
  });

  it('the widest arcs of the run stay inside the reported height, under the markers', async () => {
    const { tl, d } = await setup(CYCLE);
    const frame = { ...listFrame(tl, d.bindings), spanRight: 4, spanLeft: 5, slotCount: 7 };
    const bands = bandsOf(frame);
    // Arrow puts the apex at distance · bend · 0.175 off the chord
    const apex = (a: ReturnType<typeof linkArc>) => a.from[1] + Math.abs(a.to[0] - a.from[0]) * a.bend * 0.175;
    expect(apex(linkArc(5, 0, 'next', 7, bands.rowY))).toBeGreaterThan(0);
    expect(apex(linkArc(0, 4, 'next', 7, bands.rowY))).toBeLessThan(bands.markerY);
    expect(bands.titleY).toBeLessThan(bands.height);
    // the last node's "null" (about 0.5 wide) stays inside the reported width
    expect(nullStub(6, 7, bands.rowY).label[0] + 0.25).toBeLessThan(bands.width / 2);
  });
});
