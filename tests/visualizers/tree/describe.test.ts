/** Tree HUD lines: nodes created, links written, where each traversal call goes, visits pushed, pointers moving. */
import { describe, expect, it } from 'vitest';
import { treeVisualizer } from '../../../src/visualizers/tree';
import { BST_CLASS, example, INVERT, ITERATIVE, NARY, setup } from './cases';

/** Every non-empty HUD block of the run, in order. */
async function hud(source: string): Promise<string[][]> {
  const { tl, d } = await setup(source);
  const out: string[][] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const lines = treeVisualizer.describe!(tl, i, d);
    if (lines.length) out.push(lines);
  }
  expect(treeVisualizer.describe!(tl, 0, d)).toEqual([]);
  return out;
}

describe('tree describe', () => {
  it('bst-traversals: each insertion walks down from the root, reaches a null child and links the new node there', async () => {
    const lines = (await hud(example('bst-traversals'))).flat();
    expect(lines.slice(0, 11)).toEqual([
      'start: empty tree', 'new node 8', 'root moves to 8',
      'start at 8', 'go left of 8: null', 'new node 3', 'insert 3 as left child of 8',
      'start at 8', 'go right of 8: null', 'new node 10', 'insert 10 as right child of 8',
    ]);
    // the last insertion: 4 goes down 8 → 3 → 6
    const four = lines.indexOf('new node 4');
    expect(lines.slice(four - 4, four + 2)).toEqual(['start at 8', 'go left of 8', 'go right of 3', 'go left of 6: null', 'new node 4', 'insert 4 as left child of 6']);
  });

  it('bst-traversals: inorder, preorder and level order visits, each output growing', async () => {
    const lines = (await hud(example('bst-traversals'))).flat();
    expect(lines.filter((l) => l.startsWith('visit ')).map((l) => l.slice(6))).toEqual([
      '1', '3', '4', '6', '8', '10', '14', '8', '3', '1', '6', '4', '10', '14', '8', '3', '10', '1', '6', '14', '4',
    ]);
    expect(lines.filter((l) => l.startsWith('output ')).slice(0, 3)).toEqual(['output 1', 'output 1, 3', 'output 1, 3, 4']);
    expect(lines).toContain('output 1, 3, 4, 6, 8, 10, 14');
    expect(lines.at(-1)).toBe('output 8, 3, 10, 1, 6, 14, 4');
    // inorder runs down the left spine, finds a null on each side of the leaf 1 and visits it in between
    const inorder = lines.indexOf('start at 8', lines.indexOf('insert 4 as left child of 6'));
    expect(lines.slice(inorder, inorder + 7)).toEqual(['start at 8', 'go left of 8', 'go left of 3', 'go left of 1: null', 'visit 1', 'output 1', 'go right of 1: null']);
    // level order's loop pointer jumps from node to node
    expect(lines.filter((l) => l.startsWith('node '))).toEqual([
      'node moves to 3', 'node moves to 10', 'node moves to 1', 'node moves to 6', 'node moves to 14', 'node moves to 4',
    ]);
  });

  it('max-depth: the constructor attaches the children it is given, then the walk reaches every null', async () => {
    const lines = (await hud(example('max-depth'))).flat();
    expect(lines.slice(0, 9)).toEqual([
      'new node 9', 'new node 15', 'new node 7', 'new node 20', 'attach 15 as left child of 20', 'attach 7 as right child of 20',
      'new node 3', 'attach 9 as left child of 3', 'attach 20 as right child of 3',
    ]);
    expect(lines.slice(9)).toEqual([
      'start at 3', 'go left of 3', 'go left of 9: null', 'go right of 9: null', 'go right of 3', 'go left of 20', 'go left of 15: null',
      'go right of 15: null', 'go right of 20', 'go left of 7: null', 'go right of 7: null',
    ]);
  });

  it('iterative inorder: the pointer steps down child links and jumps back up off the stack', async () => {
    const lines = (await hud(ITERATIVE)).flat();
    const walk = lines.slice(lines.indexOf('attach 6 as right child of 4') + 1);
    expect(walk.slice(0, 8)).toEqual([
      'curr goes left of 4', 'curr goes left of 2', 'curr goes left of 1: null', 'curr moves to 1', 'visit 1', 'output 1', 'curr goes right of 1: null',
      'curr moves to 2',
    ]);
    expect(walk.at(-1)).toBe('curr goes right of 6: null');
  });

  it('n-ary: children added to their arrays, then a walk to each child in turn', async () => {
    expect((await hud(NARY)).flat()).toEqual([
      'new node 1', 'new node 2', 'new node 3', 'new node 4', 'add 2 as child of 1', 'add 3 as child of 1', 'add 4 as child of 1',
      'new node 5', 'new node 6', 'add 5 as child of 2', 'add 6 as child of 2',
      'start at 1', 'visit 1', 'output 1', 'go to child 2 of 1', 'visit 2', 'output 1, 2', 'go to child 5 of 2', 'visit 5', 'output 1, 2, 5',
      'go to child 6 of 2', 'visit 6', 'output 1, 2, 5, 6', 'go to child 3 of 1', 'visit 3', 'output 1, 2, 5, 6, 3',
      'go to child 4 of 1', 'visit 4', 'output 1, 2, 5, 6, 3, 4',
    ]);
  });

  it('rewired links read old → new; a call handed null from a variable reaches it without a side', async () => {
    const lines = (await hud(INVERT)).flat();
    expect(lines.filter((l) => l.includes('→'))).toEqual(['4.left: 2 → 7', '2.left: 1 → 3', '2.right: 3 → 1', '4.right: 7 → 2']);
    expect(lines).toContain('reach null under 7');
    // `tmp` belongs to the traversal: its moves are no news
    expect(lines.some((l) => l.startsWith('tmp'))).toBe(false);
  });

  it('a loop insertion: the pointer walks down, then the new node is linked', async () => {
    expect((await hud(BST_CLASS)).flat()).toEqual([
      'new node 5', 'new node 3', 'insert 3 as left child of 5', 'new node 8', 'insert 8 as right child of 5',
      'new node 1', 'curr goes left of 5', 'insert 1 as left child of 3', 'new node 4', 'curr goes left of 5', 'insert 4 as right child of 3',
    ]);
  });

  it('stays quiet on steps that leave the tree alone', async () => {
    const { tl, d } = await setup(example('bst-traversals'));
    const source = (i: number) => {
      const stmt = tl.meta.stmts[tl.steps[i].sid];
      return stmt ? tl.meta.source.slice(stmt.loc.start, stmt.loc.end) : '';
    };
    const checks = tl.steps.map((_, i) => i).filter((i) => tl.steps[i].kind === 'cond' && source(i).includes('queue.length'));
    expect(checks.length).toBeGreaterThan(5);
    for (const i of checks) expect(treeVisualizer.describe!(tl, i, d)).toEqual([]);
  });
});
