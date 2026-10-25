/** Tree model: stable layout, the walk at each step (current / path / visited / null child), links written, pointers, the visit order. */
import { describe, expect, it } from 'vitest';
import type { Timeline } from '../../../src/engine/timeline/types';
import { refId } from '../../../src/engine/timeline/values';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import type { TreeBindings } from '../../../src/visualizers/tree/detect';
import { buildTreeModel, LEVEL_DY, MAX_NODES, treeFrame, type TreeModel } from '../../../src/visualizers/tree/model';
import { byLabel, example, INVERT, NARY, setup } from './cases';

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });
const at = (tl: Timeline, b: TreeBindings, i: number) => buildTreeModel(tl, i, b, forward(tl, i));

const name = (m: TreeModel, id: number | null) => (id === null ? null : m.nodes.find((n) => n.id === id)?.label ?? `#${id}`);
const states = (m: TreeModel) => Object.fromEntries(m.nodes.map((n) => [n.label, n.state]));
const edges = (m: TreeModel) => m.edges.map((e) => `${name(m, e.parent)}>${name(m, e.child)}:${e.state}`);
const markers = (m: TreeModel) => m.pointers.map((p) => `${p.name}@${name(m, p.node)}/${p.stack}`);
const changes = (m: TreeModel) => m.changes.map((c) => [name(m, c.parent), c.slot, name(m, c.now), name(m, c.was)]);

/** Steps whose diff matches, in order. */
const stepsWhere = (tl: Timeline, test: (i: number) => boolean) => tl.steps.map((_, i) => i).filter(test);
/** Steps pushing to array `id`. */
const pushSteps = (tl: Timeline, id: number) => stepsWhere(tl, (i) => tl.diffs[i].heap.some((h) => h.op === 'push' && h.id === id));
/** Steps entering a call of `fn` whose node argument (the first) is null / a node. */
const callSteps = (tl: Timeline, fn: string, nullArg: boolean) => stepsWhere(tl, (i) => {
  const call = tl.steps[i].kind === 'call' ? tl.calls.get(tl.steps[i].callId) : undefined;
  return call !== undefined && tl.meta.fns[call.fnId].name === fn && (refId(call.args[0]) === null) === nullArg;
});

describe('tree layout', () => {
  it('bst-traversals: the finished tree places every node for the whole run; children keep their side', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const last = tl.steps.length - 1;
    const end = byLabel(buildTreeModel(tl, last, d.bindings, null).nodes);
    const x = (v: string) => end.get(v)!.pos[0];
    const y = (v: string) => end.get(v)!.pos[1];
    // levels 8 · 3 10 · 1 6 14 · 4
    for (const [upper, lower] of [['8', '3'], ['8', '10'], ['3', '1'], ['3', '6'], ['10', '14'], ['6', '4']]) expect(y(upper) - y(lower)).toBeCloseTo(LEVEL_DY);
    expect([x('3'), x('1')].every((v) => v < x('8'))).toBe(true);
    expect(x('10')).toBeGreaterThan(x('8'));
    expect(x('1')).toBeLessThan(x('3'));
    expect(x('6')).toBeGreaterThan(x('3'));
    // an only child still sits on its side: 14 right of 10, 4 left of 6
    expect(x('14')).toBeGreaterThan(x('10'));
    expect(x('4')).toBeLessThan(x('6'));
    const frame = treeFrame(tl, d.bindings);
    for (let i = 0; i <= last; i++) for (const n of buildTreeModel(tl, i, d.bindings, null).nodes) expect(n.pos).toEqual(frame.pos.get(n.id));
  });

  it('keeps one frame for the run: size, strip band and marker room never change', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const frame = treeFrame(tl, d.bindings);
    expect(treeFrame(tl, d.bindings)).toBe(frame);
    expect(frame).toMatchObject({ hidden: 0, maxStack: 2, strip: { len: 7 } });
    const top = Math.max(...[...frame.pos.values()].map(([, y]) => y));
    expect(frame.titleY).toBeGreaterThan(top);
    expect(frame.height).toBeGreaterThan(frame.titleY);
    expect(Math.min(...[...frame.pos.values()].map(([, y]) => y))).toBeGreaterThan(frame.strip!.y + 1);
    const xs = [...frame.pos.values()].map(([x]) => Math.abs(x));
    expect(Math.max(...xs)).toBeLessThan(frame.width / 2);
    const { tl: tl2, d: d2 } = await setup(example('max-depth'));
    expect(treeFrame(tl2, d2.bindings).strip).toBeNull();
  });

  it('n-ary children sit left to right in their array order under their parent', async () => {
    const { tl, d } = await setup(NARY);
    const m = buildTreeModel(tl, tl.steps.length - 1, d.bindings, null);
    const x = (v: string) => byLabel(m.nodes).get(v)!.pos[0];
    expect([x('2'), x('3'), x('4')]).toEqual([x('2'), x('3'), x('4')].sort((p, q) => p - q));
    expect(x('1')).toBeGreaterThan(x('2'));
    expect(x('1')).toBeLessThan(x('4'));
    expect(x('5')).toBeLessThan(x('6'));
    expect(edges(m).map((e) => e.split(':')[0]).sort()).toEqual(['1>2', '1>3', '1>4', '2>5', '2>6']);
  });

  it(`a tree past ${MAX_NODES} nodes draws its shallowest levels and counts the rest`, async () => {
    const { tl, d } = await setup(`const nodes = Array.from({ length: 210 }, (_, k) => ({ val: k, left: null, right: null }));
for (let k = 1; k < nodes.length; k++) {
  const p = nodes[(k - 1) >> 1];
  if (k % 2) p.left = nodes[k];
  else p.right = nodes[k];
}`);
    expect(treeFrame(tl, d.bindings).hidden).toBe(210 - MAX_NODES);
    const m = buildTreeModel(tl, tl.steps.length - 1, d.bindings, null);
    expect(m.nodes.map((n) => Number(n.label)).sort((p, q) => p - q)).toEqual(Array.from({ length: MAX_NODES }, (_, k) => k));
  });
});

describe('tree model', () => {
  it('a node appears when created and drops in; stepping back over its creation removes it', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const i = stepsWhere(tl, (k) => tl.diffs[k].heap.some((h) => h.op === 'alloc' && d.bindings.nodeIds.includes(h.id)))[0];
    const fwd = at(tl, d.bindings, i);
    expect(fwd.nodes).toEqual([expect.objectContaining({ label: '8', isNew: true, color: COLORS.changed })]);
    expect(fwd.focus).toEqual(fwd.nodes[0].pos);
    expect(buildTreeModel(tl, i - 1, d.bindings, backward(tl, i - 1)).nodes).toEqual([]);
  });

  it('a call on the empty tree looks at the place where the root will be', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const [first] = callSteps(tl, 'insert', true);
    const m = at(tl, d.bindings, first);
    expect(m.nodes).toEqual([]);
    expect(m.current).toBeNull();
    expect(m.nullAt).toEqual({ pos: treeFrame(tl, d.bindings).pos.get(d.bindings.nodeIds[0]), parent: null });
  });

  it('insert: the calls down to the insertion point, the null child reached, then the new link glowing', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const b = d.bindings;
    // the last insertion: 4 becomes 6's left child
    const reach = callSteps(tl, 'insert', true).at(-1)!;
    const before = at(tl, b, reach);
    expect(before.current).toBeNull();
    expect(before.path.map((id) => name(before, id))).toEqual(['8', '3', '6']);
    expect(states(before)).toMatchObject({ 8: 'path', 3: 'path', 6: 'path', 1: 'idle', 10: 'idle', 14: 'idle' });
    const six = byLabel(before.nodes).get('6')!.pos;
    expect(before.nullAt!.parent).toEqual(six);
    expect(before.nullAt!.pos[0]).toBeLessThan(six[0]);
    expect(before.nullAt!.pos[1]).toBeCloseTo(six[1] - LEVEL_DY / 2);
    expect(before.focus).toEqual(before.nullAt!.pos);

    const write = stepsWhere(tl, (k) => k > reach && tl.diffs[k].heap.some((h) => h.op === 'set' && h.path[0] === 'left' && refId(h.value) !== null))[0];
    const m = at(tl, b, write);
    expect(changes(m)).toEqual([['6', 0, '4', null]]);
    expect(edges(m)).toContain('6>4:changed');
    expect(m.edges.find((e) => e.state === 'changed')?.color).toBe(COLORS.changed);
    expect(name(m, m.current)).toBe('6');
    expect(m.path.map((id) => name(m, id))).toEqual(['8', '3']);

    // stepping back over it: the link is undone (4 → null) and gone
    const back = buildTreeModel(tl, write - 1, b, backward(tl, write - 1));
    expect(changes(back)).toEqual([['6', 0, null, '4']]);
    expect(edges(back).some((e) => e.startsWith('6>4'))).toBe(false);
  });

  it('inorder: the current node, the calls above it, the nodes visited so far and the visit order with the value just pushed', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const b = d.bindings;
    // out.push(6)
    const i = pushSteps(tl, b.outputs[0].objId)[3];
    const m = at(tl, b, i);
    expect(name(m, m.current)).toBe('6');
    expect(states(m)).toEqual({ 8: 'path', 3: 'path', 10: 'idle', 1: 'visited', 6: 'current', 14: 'idle', 4: 'visited' });
    expect(byLabel(m.nodes).get('6')).toMatchObject({ color: COLORS.current });
    expect(byLabel(m.nodes).get('3')).toMatchObject({ color: COLORS.visited });
    expect(edges(m)).toEqual(['8>3:path', '8>10:idle', '3>1:visited', '3>6:path', '10>14:idle', '6>4:visited']);
    expect(m.strip).toEqual({
      name: 'out', more: 0, items: [{ label: '1', pulse: false }, { label: '3', pulse: false }, { label: '4', pulse: false }, { label: '6', pulse: true }],
    });
    expect(m.focus).toEqual(byLabel(m.nodes).get('6')!.pos);
    // stepping back over the push: 6 is not in the order yet, and nothing pulses
    const back = buildTreeModel(tl, i - 1, b, backward(tl, i - 1));
    expect(back.strip!.items).toEqual([{ label: '1', pulse: false }, { label: '3', pulse: false }, { label: '4', pulse: false }]);
  });

  it('each walk starts fresh: preorder forgets what inorder visited and fills its own strip', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const b = d.bindings;
    const start = callSteps(tl, 'preorder', false)[0];
    const end = at(tl, b, start - 1);
    expect(Object.values(states(end)).filter((s) => s === 'visited')).toHaveLength(6);
    expect(end.strip!.items.map((x) => x.label)).toEqual(['1', '3', '4', '6', '8', '10', '14']);
    const fresh = at(tl, b, start);
    expect(states(fresh)).toEqual({ 8: 'current', 3: 'idle', 10: 'idle', 1: 'idle', 6: 'idle', 14: 'idle', 4: 'idle' });
    expect(fresh.strip).toEqual({ name: 'out', items: [], more: 0 });
    const third = at(tl, b, pushSteps(tl, b.outputs[1].objId)[2]);
    expect(third.strip!.items.map((x) => x.label)).toEqual(['8', '3', '1']);
    expect(states(third)).toMatchObject({ 8: 'path', 3: 'path', 1: 'current', 6: 'idle' });
  });

  it('level order (a loop): the pointer that moved last is the current node, the result fills the strip', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const b = d.bindings;
    const m = at(tl, b, pushSteps(tl, b.outputs[2].objId)[2]);
    expect(name(m, m.current)).toBe('10');
    expect(m.path).toEqual([]);
    expect(states(m)).toEqual({ 8: 'visited', 3: 'visited', 10: 'current', 1: 'idle', 6: 'idle', 14: 'idle', 4: 'idle' });
    expect(m.strip).toMatchObject({ name: 'result', items: [{ label: '8' }, { label: '3' }, { label: '10', pulse: true }] });
    expect(markers(m)).toEqual(['root@8/0', 'node@10/0']);
  });

  it('max-depth: a leaf’s missing children are looked at left, then right; finished calls show what they returned', async () => {
    const { tl, d } = await setup(example('max-depth'));
    const b = d.bindings;
    const [left, right] = callSteps(tl, 'maxDepth', true);
    const l = at(tl, b, left);
    const nine = byLabel(l.nodes).get('9')!.pos;
    expect(l.path.map((id) => name(l, id))).toEqual(['3', '9']);
    expect(l.nullAt!.parent).toEqual(nine);
    expect(l.nullAt!.pos[0]).toBeLessThan(nine[0]);
    expect(at(tl, b, right).nullAt!.pos[0]).toBeGreaterThan(nine[0]);
    // 9's call returns 1: 9 is visited, with its depth, while 3 carries on to the right
    const back = at(tl, b, callSteps(tl, 'maxDepth', false)[2]);
    expect(states(back)).toMatchObject({ 3: 'path', 9: 'visited', 20: 'current', 15: 'idle', 7: 'idle' });
    expect(byLabel(back.nodes).get('9')!.badge).toBe('= 1');
    const end = byLabel(buildTreeModel(tl, tl.steps.length - 1, b, null).nodes);
    expect(['3', '9', '20', '15', '7'].map((v) => end.get(v)!.badge)).toEqual(['= 3', '= 1', '= 2', '= 1', '= 1']);
  });

  it('pointers stack on a shared node, a same-named shadow shows once, a finished call’s pointers vanish', async () => {
    const { tl, d } = await setup(example('max-depth'));
    const b = d.bindings;
    const [call] = callSteps(tl, 'maxDepth', false);
    const m = at(tl, b, call);
    expect(markers(m)).toEqual(['root@3/0', 'node@3/1']);
    expect(m.pointers.map((p) => p.color)).toEqual([COLORS.done, COLORS.current]);
    expect(markers(at(tl, b, tl.steps.length - 1))).toEqual(['root@3/0']);
    const { tl: bst, d: bd } = await setup(example('bst-traversals'));
    // the global root and insert's root parameter both hold 8
    expect(markers(at(bst, bd.bindings, callSteps(bst, 'insert', false)[0]))).toEqual(['root@8/0']);
  });

  it('rewired links keep the nodes in place: once inverted, the edges run to the other side', async () => {
    const { tl, d } = await setup(INVERT);
    const m = buildTreeModel(tl, tl.steps.length - 1, d.bindings, null);
    expect(edges(m).map((e) => e.split(':')[0])).toEqual(['2>3', '2>1', '4>7', '4>2']);
    const pos = (v: string) => byLabel(m.nodes).get(v)!.pos;
    // 7 is 4's left child now, still drawn right of it
    expect(pos('7')[0]).toBeGreaterThan(pos('4')[0]);
  });

  it('adding n-ary children glows their links', async () => {
    const { tl, d } = await setup(NARY);
    const nodes = new Set(d.bindings.nodeIds);
    const i = stepsWhere(tl, (k) => tl.diffs[k].heap.some((h) => h.op === 'push' && (h.args ?? []).some((v) => nodes.has(refId(v) ?? -1))))[0];
    const m = at(tl, d.bindings, i);
    expect(changes(m)).toEqual([['1', -1, '2', null], ['1', -1, '3', null], ['1', -1, '4', null]]);
    expect(edges(m)).toEqual(['1>2:changed', '1>3:changed', '1>4:changed']);
  });
});
