/** Tree detection: node shapes, value and child keys, root / pointer variables, traversals, visit-order arrays, what is no tree. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { refId } from '../../../src/engine/timeline/values';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import { treeVisualizer } from '../../../src/visualizers/tree';
import type { TreeBindings } from '../../../src/visualizers/tree/detect';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import { BST_CLASS, example, fnNames, ITERATIVE, NARY, PLAIN_OBJECTS, qualified, setup } from './cases';

async function trees(source: string): Promise<Detection<TreeBindings>[]> {
  const tl = await timelineOf(source);
  return treeVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
}

/** What the stage shows with every registered plugin (the tree plugin included once). */
async function stage(source: string): Promise<Detection[]> {
  const tl = await timelineOf(source);
  const plugins = [...visualizers().filter((p) => p.id !== 'tree'), treeVisualizer];
  return selectDetections(detectAll(tl, plugins).all);
}

const pointers = (tl: Timeline, d: Detection<TreeBindings>) => d.bindings.pointers.map((p) => qualified(tl, p));

describe('tree detection', () => {
  it('bst-traversals: TreeNode nodes linked by left / right, the recursive walks and the arrays they fill', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    expect(d).toMatchObject({ vizId: 'tree', key: 'tree:TreeNode', title: 'root', score: 0.9, role: 'primary' });
    expect(d.mode).toBeUndefined();
    const b = d.bindings;
    expect(b).toMatchObject({ nodeShape: 'TreeNode', valueKey: 'val', childKeys: ['left', 'right'] });
    expect(b.nodeIds).toHaveLength(7);
    expect(b.rootVar).toMatchObject({ name: 'root', fnId: 0 });
    // levelOrder loops instead of recursing: its variables are pointers, the function no traversal
    expect(fnNames(tl, b.traversalFns)).toEqual(['insert', 'inorder', 'preorder']);
    expect(pointers(tl, d)).toEqual(['(program):root', 'insert:root', 'inorder:node', 'preorder:node', 'levelOrder:root', 'levelOrder:node']);
    expect(qualified(tl, b.output!)).toBe('inorder:out');
    expect(b.outputs.map((o) => qualified(tl, o.ref))).toEqual(['inorder:out', 'preorder:out', 'levelOrder:result']);
    expect(d.claims).toEqual([
      ...b.nodeIds.map((id) => `obj:${id}`), ...b.pointers.map(varKey), ...b.traversalFns.map((f) => `fn:${f}`),
      ...b.outputs.flatMap((o) => [`obj:${o.objId}`, varKey(o.ref)]),
    ]);
  });

  it('bst-traversals among all plugins: the tree is primary, the level-order queue stays, the recursion trees give way', async () => {
    const active = await stage(example('bst-traversals'));
    expect(active[0]).toMatchObject({ vizId: 'tree', role: 'primary' });
    expect(active.find((d) => d.vizId === 'queue')).toMatchObject({ title: 'queue', mode: 'fifo' });
    expect(active.some((d) => d.vizId === 'recursionTree')).toBe(false);
  });

  it('max-depth: nodes wired by the constructor, the recursion as the traversal, no visit-order array', async () => {
    const { tl, d } = await setup(example('max-depth'));
    expect(d).toMatchObject({ key: 'tree:TreeNode', title: 'root' });
    const b = d.bindings;
    expect(b.nodeIds).toHaveLength(5);
    expect(fnNames(tl, b.traversalFns)).toEqual(['maxDepth']);
    // the constructor's left / right parameters only wire up a new node
    expect(pointers(tl, d)).toEqual(['(program):root', 'maxDepth:node']);
    expect(b.output).toBeUndefined();
    expect(b.outputs).toEqual([]);
  });

  it('max-depth among all plugins: the tree is primary beside the call stack, without a recursion tree', async () => {
    const active = await stage(example('max-depth'));
    expect(active.map((d) => `${d.vizId}:${d.role}`)).toEqual(['tree:primary', 'callStack:aux']);
  });

  it('n-ary nodes link through their children arrays (claimed with them)', async () => {
    const { tl, d } = await setup(NARY);
    const b = d.bindings;
    expect(b).toMatchObject({ nodeShape: 'Node', valueKey: 'val', childKeys: ['children'] });
    expect(b.nodeIds).toHaveLength(6);
    expect(fnNames(tl, b.traversalFns)).toEqual(['preorder']);
    expect(pointers(tl, d)).toEqual(['(program):root', '(program):a', 'preorder:node', 'preorder:child']);
    expect(b.outputs.map((o) => qualified(tl, o.ref))).toEqual(['preorder:out']);
    const heap = tl.snapshots[tl.snapshots.length - 1].heap;
    const childArrays = b.nodeIds.map((id) => refId(heap.get(id)?.props?.get('children')?.v));
    expect(d.claims).toEqual(expect.arrayContaining(childArrays.map((id) => `obj:${id}`)));
    expect((await stage(NARY))[0].vizId).toBe('tree');
  });

  it('plain-object nodes share a shape by their non-link property names', async () => {
    const { tl, d } = await setup(PLAIN_OBJECTS);
    expect(d).toMatchObject({ key: 'tree:{val}', title: 'tree' });
    expect(d.bindings.nodeIds).toHaveLength(4);
    expect(fnNames(tl, d.bindings.traversalFns)).toEqual(['sum']);
  });

  it('without recursion: loop pointers, a visit-order array, and the explicit stack left to the stack view', async () => {
    const { tl, d } = await setup(ITERATIVE);
    expect(d.bindings.traversalFns).toEqual([]);
    expect(pointers(tl, d)).toEqual(['(program):root', 'inorder:root', 'inorder:curr']);
    expect(qualified(tl, d.bindings.output!)).toBe('inorder:res');
    expect((await stage(ITERATIVE)).map((x) => `${x.vizId}:${x.role}`)).toEqual(['tree:primary', 'stack:secondary']);
  });

  it('a tree kept by a class is named after the variable holding it', async () => {
    const { tl, d } = await setup(BST_CLASS);
    expect(d).toMatchObject({ key: 'tree:Node', title: 't' });
    expect(d.bindings.valueKey).toBe('value');
    expect(pointers(tl, d)).toEqual(['insert:node', 'insert:curr']);
  });

  it('values come from the first plain property when none is named val / value / key / data', async () => {
    const [d] = await trees(`const leaf = (label) => ({ up: null, label, left: null, right: null });
const r = leaf('r');
r.left = leaf('a');
r.right = leaf('b');
r.left.up = r;`);
    // `up` links nodes, so it is no value
    expect(d.bindings.valueKey).toBe('label');
    expect(d.bindings.nodeIds).toHaveLength(3);
  });

  it('nodes never linked to each other are no tree; neither are list nodes', async () => {
    expect(await trees('class N {\n  constructor(v) {\n    this.val = v;\n    this.left = null;\n    this.right = null;\n  }\n}\nconst a = new N(1);\nconst b = new N(2);')).toEqual([]);
    expect(await trees('const range = { left: 0, right: 5 };\nrange.left = 2;')).toEqual([]);
  });

  it.each(['reverse-list', 'loop-sum', 'fibonacci', 'merge-sort', 'bfs', 'dfs', 'islands', 'n-queens', 'valid-parentheses', 'dijkstra', 'queue-simulation'])(
    'finds no tree in %s',
    async (id) => {
      expect(await trees(example(id))).toEqual([]);
    },
  );

  it('is a primary-capable plugin with a lazily loaded component and a nearly level camera', () => {
    expect(treeVisualizer).toMatchObject({ id: 'tree', label: 'Tree', cameraTilt: 0.16 });
    expect((treeVisualizer.Component as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'));
  });
});
