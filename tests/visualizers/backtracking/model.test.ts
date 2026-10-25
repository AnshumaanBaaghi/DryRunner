/** Backtracking model: choices on the edges, solutions and dead ends, node looks and the panel per step. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { valueAt } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { refId } from '../../../src/engine/timeline/values';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { detectBacktracking, type BacktrackBindings } from '../../../src/visualizers/backtracking/detect';
import {
  buildPanel, nodeLabels, nodeLook, nodeMark, PATH_COLOR, treeInfo, type TreeInfo,
} from '../../../src/visualizers/backtracking/model';
import { panelLayout } from '../../../src/visualizers/backtracking/panel';
import { buildCallTree, type CallTree, type TreeNode } from '../../../src/visualizers/shared/callTree';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

interface Setup {
  tl: Timeline;
  d: Detection<BacktrackBindings>;
  b: BacktrackBindings;
  tree: CallTree;
  info: TreeInfo;
}

async function setup(id: string): Promise<Setup> {
  const tl = await timelineOf(exampleById(id)!.code);
  const [d] = detectBacktracking({ tl, analysis: analyzeTrace(tl) });
  const tree = buildCallTree(tl, d.bindings.fnIds);
  return { tl, d, b: d.bindings, tree, info: treeInfo(tl, tree, d.bindings) };
}

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** stepping back from i + 1 to i: the undone step's changes */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });

/** Steps whose changes include an operation on the object `ref` holds. */
function stepsWith(tl: Timeline, ref: BacktrackBindings['path'], op: string, arg?: unknown): number[] {
  const out: number[] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const id = refId(valueAt(tl, ref!, i));
    if (tl.diffs[i].heap.some((h) => h.id === id && h.op === op && (arg === undefined || h.args?.[0] === arg || h.old === arg))) out.push(i);
  }
  return out;
}

const nodes = (tree: CallTree) => [...tree.nodes.values()];
const childrenOf = (tree: CallTree, n: TreeNode) => n.children.map((c) => tree.nodes.get(c)!);

describe('backtracking tree annotations', () => {
  it('labels each edge with the value pushed right before the call; every subsets call records one', async () => {
    const { tree, info } = await setup('subsets');
    const root = tree.nodes.get(tree.roots[0])!;
    expect(childrenOf(tree, root).map((c) => info.choice.get(c.callId))).toEqual(['+1', '+2', '+3']);
    expect(info.choice.has(root.callId)).toBe(false);
    expect(nodes(tree).map((n) => info.solution.get(n.callId)?.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(info.solutionSteps).toHaveLength(8);
    expect(info.barren.size).toBe(0);
  });

  it('finds the two N-Queens solutions and the dead ends', async () => {
    const { tl, tree, info, b } = await setup('n-queens');
    expect(info.solutionSteps).toHaveLength(2);
    const solved = nodes(tree).filter((n) => info.solution.has(n.callId));
    expect(solved.map((n) => n.args[0])).toEqual([4, 4]);
    // an edge names the cell the parent placed its queen on: the parent's row
    for (const n of nodes(tree)) {
      if (n.parent === null) continue;
      expect(info.choice.get(n.callId)).toMatch(new RegExp(`^\\(${tree.nodes.get(n.parent)!.args[0]},[0-3]\\)$`));
    }
    const root = tree.nodes.get(tree.roots[0])!;
    expect(childrenOf(tree, root).map((c) => info.choice.get(c.callId))).toEqual(['(0,0)', '(0,1)', '(0,2)', '(0,3)']);
    // the first and last queen placements in row 0 lead nowhere
    const [first, , , last] = childrenOf(tree, root);
    expect(info.barren.has(first.callId) && info.barren.has(last.callId)).toBe(true);
    expect(info.barren.has(root.callId)).toBe(false);
    expect(info.blank).toBe("s:.");
    // a dead end is marked only once it has returned
    expect(nodeMark(info, first, first.exitStep! - 1, true)).toBeNull();
    expect(nodeMark(info, first, first.exitStep!, true)).toEqual({ kind: 'pruned' });
    expect(nodeMark(info, first, first.exitStep!, false)).toBeNull();
    const sol = solved[0];
    const step = info.solution.get(sol.callId)!.step;
    expect(nodeMark(info, sol, step - 1, true)).toBeNull();
    expect(nodeMark(info, sol, step, true)).toEqual({ kind: 'solution', index: 1 });
    expect(b.board?.name).toBe('board');
    expect(tl.status).toBe('ok');
  });

  it('labels permutation edges by the pushed value; the leaves are the solutions', async () => {
    const { tree, info } = await setup('permutations');
    const root = tree.nodes.get(tree.roots[0])!;
    expect(childrenOf(tree, root).map((c) => info.choice.get(c.callId))).toEqual(['+1', '+2', '+3']);
    const leaves = nodes(tree).filter((n) => n.children.length === 0);
    expect(leaves).toHaveLength(6);
    expect(leaves.every((n) => info.solution.has(n.callId))).toBe(true);
    expect(info.solution.size).toBe(6);
  });

  it('labels the root call in full and below it only what changes between calls', async () => {
    const queens = await setup('n-queens');
    const labels = nodeLabels(queens.tl, queens.tree);
    const root = queens.tree.roots[0];
    expect(labels.get(root)).toBe('place(0)');
    expect(labels.get(queens.tree.nodes.get(root)!.children[0])).toBe('(1)');
    const perms = await setup('permutations');
    const plabels = nodeLabels(perms.tl, perms.tree);
    expect(plabels.get(perms.tree.roots[0])).toBe('backtrack()');
    expect(plabels.get(perms.tree.nodes.get(perms.tree.roots[0])!.children[0])).toBe('');
  });

  it('looks: solutions glow green with their number, dead ends fade red', () => {
    const solved = nodeLook('returned', { kind: 'solution', index: 2 }, '(4)');
    expect(solved).toMatchObject({ color: COLORS.done, badge: '✓ #2', badgeColor: COLORS.done, label: '(4)' });
    expect(nodeLook('active', { kind: 'solution', index: 1 }, '').color).toBe(COLORS.done);
    // still on the stack: keeps the waiting color, shows the badge
    expect(nodeLook('waiting', { kind: 'solution', index: 1 }, '')).toMatchObject({ color: COLORS.visited, badge: '✓ #1' });
    const pruned = nodeLook('returned', { kind: 'pruned' }, '(2)');
    expect(pruned).toMatchObject({ color: COLORS.error, badge: '✗' });
    expect(pruned.opacity).toBeLessThan(0.5);
    expect(nodeLook('returned', null, '(1)', 'true').badge).toBe('= true');
    expect(nodeLook('active', null, 'x').color).toBe(COLORS.current);
  });
});

describe('backtracking panel', () => {
  it('path: the current elements, a pushed slot entering and a popped one leaving', async () => {
    const { tl, b, info } = await setup('subsets');
    const push2 = stepsWith(tl, b.path, 'push', 2)[0];
    const p = buildPanel(tl, push2, b, info, forward(tl, push2)).path!;
    expect(p.slots.map((s) => s.label)).toEqual(['1', '2']);
    expect(p.slots.map((s) => s.entered)).toEqual([false, true]);
    expect(p.slots[1]).toMatchObject({ pulse: true, color: COLORS.changed });
    expect(p.slots[0].color).toBe(PATH_COLOR);
    expect(p.capacity).toBe(3);
    expect(p.leaving).toBeNull();

    const pop3 = stepsWith(tl, b.path, 'pop', 3)[0];
    const q = buildPanel(tl, pop3, b, info, forward(tl, pop3)).path!;
    expect(q.slots.map((s) => s.label)).toEqual(['1', '2']);
    expect(q.leaving).toEqual({ index: 2, label: '3' });

    // stepping back over the push: the element leaves again; over the pop: it drops back in
    const undoPush = buildPanel(tl, push2 - 1, b, info, backward(tl, push2 - 1)).path!;
    expect(undoPush.slots.map((s) => s.label)).toEqual(['1']);
    expect(undoPush.leaving).toEqual({ index: 1, label: '2' });
    const undoPop = buildPanel(tl, pop3 - 1, b, info, backward(tl, pop3 - 1)).path!;
    expect(undoPop.slots.map((s) => s.label)).toEqual(['1', '2', '3']);
    expect(undoPop.slots[2].entered).toBe(true);
    expect(undoPop.leaving).toBeNull();
  });

  it('board: placed queens raised as choices, the changed cell, the cells being checked', async () => {
    const { tl, b, info } = await setup('n-queens');
    const placeAt = tl.steps.findIndex((_, i) => tl.diffs[i].heap.some((h) => h.op === 'set' && h.value === 'Q'));
    const m = buildPanel(tl, placeAt, b, info, forward(tl, placeAt)).board!;
    expect(m).toMatchObject({ name: 'board', exists: true, rows: 4, cols: 4 });
    expect(m.placed.filter(Boolean)).toHaveLength(1);
    expect(m.placed[0]).toBe(true);
    expect(m.text[0]).toBe('Q');
    // the resting '.' is left unlabeled
    expect(m.text.slice(1).every((t) => t === '')).toBe(true);
    expect(m.marks).toEqual([{ r: 0, c: 0, kind: 'changed' }]);

    // isSafe(1, 1) looking up at row 0
    const check = tl.steps.findIndex((_, i) => i > placeAt && tl.diffs[i].reads.length === 2 && buildPanel(tl, i, b, info, forward(tl, i)).board!.marks.length);
    const c = buildPanel(tl, check, b, info, forward(tl, check)).board!;
    expect(c.marks.every((x) => x.kind === 'checking' && x.r === 0)).toBe(true);

    const removeAt = tl.steps.findIndex((_, i) => tl.diffs[i].heap.some((h) => h.op === 'set' && h.value === '.' && h.old === 'Q'));
    const after = buildPanel(tl, removeAt, b, info, forward(tl, removeAt)).board!;
    const before = buildPanel(tl, removeAt - 1, b, info, null).board!;
    expect(after.placed.filter(Boolean).length).toBe(before.placed.filter(Boolean).length - 1);
    expect(after.marks.filter((x) => x.kind === 'changed')).toHaveLength(1);

    const early = buildPanel(tl, 1, b, info, null).board!;
    expect(early.exists).toBe(false);
    expect([early.rows, early.cols]).toEqual([4, 4]);
  });

  it('flags: used slots show ✓, pulse when set and turn violet when checked', async () => {
    const { tl, b, info } = await setup('permutations');
    const set = tl.steps.findIndex((_, i) => tl.diffs[i].heap.some((h) => h.op === 'set' && h.value === true));
    const f = buildPanel(tl, set, b, info, forward(tl, set)).flags!;
    expect(f.name).toBe('used');
    expect(f.slots.map((s) => s.label)).toEqual(['✓', '', '']);
    expect(f.slots[0]).toMatchObject({ pulse: true, color: COLORS.changed, sub: '0' });
    expect(f.slots[1].color).toBe(COLORS.idle);
    const read = tl.steps.findIndex((_, i) => i > set && tl.diffs[i].reads.some((r) => r.path[0] === 0) && !tl.diffs[i].heap.length);
    const g = buildPanel(tl, read, b, info, forward(tl, read)).flags!;
    expect(g.slots[0].color).toBe(COLORS.frontier);
  });

  it('results: the count, the latest one and the step that found it', async () => {
    const { tl, b, info } = await setup('subsets');
    const second = info.solutionSteps[1];
    const r = buildPanel(tl, second, b, info, forward(tl, second)).results!;
    expect(r).toMatchObject({ name: 'result', count: 2, latest: '[1]', found: true });
    expect(buildPanel(tl, second + 1, b, info, forward(tl, second + 1)).results!.found).toBe(false);
    expect(buildPanel(tl, 0, b, info, null).results).toMatchObject({ count: 0, latest: null });
    const last = buildPanel(tl, tl.steps.length - 1, b, info, null).results!;
    expect(last.count).toBe(8);
    expect(last.widest).toBe('[1, 2, 3]'.length);
  });

  it.each(['subsets', 'n-queens', 'permutations'])('keeps one panel size through the trace, parts stacked apart (%s)', async (id) => {
    const { tl, b, info } = await setup(id);
    const sizes = new Set<string>();
    for (let i = 0; i < tl.steps.length; i += 7) {
      const geo = panelLayout(buildPanel(tl, i, b, info, forward(tl, i)), b.mode);
      sizes.add(`${geo.w.toFixed(3)}x${geo.h.toFixed(3)}`);
      for (let k = 1; k < geo.parts.length; k++) expect(geo.parts[k].y).toBeGreaterThanOrEqual(geo.parts[k - 1].y + geo.parts[k - 1].h);
    }
    expect(sizes.size).toBe(1);
  });
});
