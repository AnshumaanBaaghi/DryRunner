/** Shared call-tree model: structure, phases per step, node budget and tidy layout. */
import { describe, expect, it } from 'vitest';
import { exampleById } from '../../../src/examples';
import {
  activeNode, buildCallTree, callText, constantArgs, displaySet, hasReturned, layoutTree, pathTo, phaseAt,
} from '../../../src/visualizers/shared/callTree';
import { timelineOf } from '../../helpers/timeline';

const fnId = (tl: Awaited<ReturnType<typeof timelineOf>>, name: string) => tl.meta.fns.find((f) => f.name === name)!.id;

describe('call tree', () => {
  it('nests recursive calls and skips helper functions', async () => {
    const tl = await timelineOf(exampleById('merge-sort')!.code);
    const tree = buildCallTree(tl, [fnId(tl, 'mergeSort')]);
    expect(tree.roots).toHaveLength(1);
    expect(tree.nodes.size).toBe(13); // 7 elements → 7 leaves + 6 splits
    const root = tree.nodes.get(tree.roots[0])!;
    expect(root.children).toHaveLength(2);
    expect(root.size).toBe(13);
    expect(Math.max(...[...tree.nodes.values()].map((n) => n.depth))).toBe(3);
  });

  it('knows each call’s phase and the active path at every step', async () => {
    const tl = await timelineOf(exampleById('fibonacci')!.code);
    const tree = buildCallTree(tl, [fnId(tl, 'fib')]);
    expect(tree.nodes.size).toBe(15);
    for (let i = 0; i < tl.steps.length; i++) {
      const active = activeNode(tl, tree, i);
      const onStack = [...tree.nodes.values()].filter((n) => phaseAt(n, i, active) === 'waiting').map((n) => n.callId);
      const path = pathTo(tree, active);
      // everything still waiting is exactly the path above the active call
      expect(onStack.sort()).toEqual(path.slice(0, -1).sort());
      for (const n of tree.nodes.values()) {
        const phase = phaseAt(n, i, active);
        if (phase === 'future') expect(n.enterStep).toBeGreaterThan(i);
        if (phase === 'returned') expect(hasReturned(n, i)).toBe(true);
      }
    }
    const last = tl.steps.length - 1;
    expect([...tree.nodes.values()].every((n) => phaseAt(n, last, activeNode(tl, tree, last)) === 'returned')).toBe(true);
  });

  it('keeps the shallow levels and the active path within the node budget', async () => {
    const tl = await timelineOf('function f(n) {\n  if (n <= 1) return 1;\n  return f(n - 1) + f(n - 2);\n}\nf(9);');
    const tree = buildCallTree(tl, [fnId(tl, 'f')]);
    expect(tree.nodes.size).toBe(109);
    const deepest = [...tree.nodes.values()].reduce((a, b) => (b.depth > a.depth ? b : a));
    const set = displaySet(tree, 30, deepest.callId);
    for (const id of pathTo(tree, deepest.callId)) expect(set.ids.has(id)).toBe(true);
    const shallow = [...set.ids].filter((id) => !pathTo(tree, deepest.callId).includes(id));
    expect(shallow.length).toBeLessThanOrEqual(30);
    const hiddenTotal = [...set.hidden.values()].reduce((a, b) => a + b, 0);
    expect(set.ids.size + hiddenTotal).toBe(tree.nodes.size);
    const expanded = displaySet(tree, 30, null, new Set([tree.roots[0]]));
    expect(expanded.ids.size).toBeGreaterThan(30);
  });

  it('lays nodes out without overlaps, wide nodes pushing neighbors apart', async () => {
    const tl = await timelineOf(exampleById('fibonacci')!.code);
    const tree = buildCallTree(tl, [fnId(tl, 'fib')]);
    const ids = new Set(tree.nodes.keys());
    const widthOf = (n: { args: unknown[] }) => (n.args[0] === 3 ? 2.5 : 1);
    const { pos, width, height } = layoutTree(tree, ids, { dy: 1.5, gap: 0.3, widthOf });
    expect(pos.size).toBe(15);
    const byLevel = new Map<number, number[]>();
    for (const [id, [x, y]] of pos) {
      expect(Math.abs(x)).toBeLessThanOrEqual(width / 2 + 1e-9);
      expect(y).toBeLessThanOrEqual(height + 1e-9);
      byLevel.set(y, [...(byLevel.get(y) ?? []), id]);
    }
    for (const level of byLevel.values()) {
      const xs = level.map((id) => ({ x: pos.get(id)![0], w: widthOf(tree.nodes.get(id)!) })).sort((a, b) => a.x - b.x);
      for (let k = 1; k < xs.length; k++) expect(xs[k].x - xs[k - 1].x).toBeGreaterThanOrEqual((xs[k].w + xs[k - 1].w) / 2 + 0.3 - 1e-9);
    }
    const root = pos.get(tree.roots[0])!;
    expect(root[1]).toBe(Math.max(...[...pos.values()].map((p) => p[1])));
  });

  it('labels calls, naming arguments that are the same object in every call', async () => {
    const tl = await timelineOf(exampleById('quick-sort')!.code);
    const tree = buildCallTree(tl, [fnId(tl, 'quickSort')]);
    const constant = constantArgs(tree).get(fnId(tl, 'quickSort'))!;
    expect([...constant]).toEqual([0]);
    const root = tree.nodes.get(tree.roots[0])!;
    expect(callText(tl, tl.snapshots[root.enterStep], root, constant)).toBe('quickSort(arr, 0, 7)');
  });
});
