/** Tree sources and setup shared by the detector, model and HUD tests. */
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { VarRef } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { treeVisualizer } from '../../../src/visualizers/tree';
import type { TreeBindings } from '../../../src/visualizers/tree/detect';
import type { NodeModel } from '../../../src/visualizers/tree/model';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

/** 1 → (2, 3, 4), 2 → (5, 6): children arrays filled with push, then walked in preorder into `out`. */
export const NARY = `class Node {
  constructor(val) {
    this.val = val;
    this.children = [];
  }
}
const root = new Node(1);
const a = new Node(2);
root.children.push(a, new Node(3), new Node(4));
a.children.push(new Node(5), new Node(6));
function preorder(node, out) {
  out.push(node.val);
  for (const child of node.children) preorder(child, out);
  return out;
}
console.log(preorder(root, []));
`;

/** Inorder without recursion: an explicit stack and a `curr` pointer stepping down child links. */
export const ITERATIVE = `class TreeNode {
  constructor(val, left = null, right = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}
const root = new TreeNode(4, new TreeNode(2, new TreeNode(1), new TreeNode(3)), new TreeNode(6));
function inorder(root) {
  const res = [];
  const stack = [];
  let curr = root;
  while (curr || stack.length) {
    while (curr) {
      stack.push(curr);
      curr = curr.left;
    }
    curr = stack.pop();
    res.push(curr.val);
    curr = curr.right;
  }
  return res;
}
console.log(inorder(root));
`;

/** Nested object literals (leaves without a right child) summed recursively. */
export const PLAIN_OBJECTS = `const tree = { val: 1, left: { val: 2, left: null, right: null }, right: { val: 3, left: { val: 4, left: null, right: null }, right: null } };
function sum(node) {
  if (!node) return 0;
  return node.val + sum(node.left) + sum(node.right);
}
console.log(sum(tree));
`;

/** A BST kept by a class (`t.root`), filled by walking `curr` down from the root. */
export const BST_CLASS = `class Node {
  constructor(v) {
    this.value = v;
    this.left = null;
    this.right = null;
  }
}
class BST {
  constructor() {
    this.root = null;
  }
  insert(v) {
    const node = new Node(v);
    if (!this.root) {
      this.root = node;
      return;
    }
    let curr = this.root;
    while (true) {
      if (v < curr.value) {
        if (!curr.left) {
          curr.left = node;
          return;
        }
        curr = curr.left;
      } else {
        if (!curr.right) {
          curr.right = node;
          return;
        }
        curr = curr.right;
      }
    }
  }
}
const t = new BST();
for (const v of [5, 3, 8, 1, 4]) t.insert(v);
`;

/** Mirrors 4 → (2 → (1, 3), 7): every left / right link is rewired. */
export const INVERT = `class TreeNode {
  constructor(val, left = null, right = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}
function invert(node) {
  if (node === null) return null;
  const tmp = node.left;
  node.left = invert(node.right);
  node.right = invert(tmp);
  return node;
}
const root = new TreeNode(4, new TreeNode(2, new TreeNode(1), new TreeNode(3)), new TreeNode(7));
invert(root);
`;

export const example = (id: string) => exampleById(id)!.code;

export async function setup(source: string): Promise<{ tl: Timeline; d: Detection<TreeBindings> }> {
  const tl = await timelineOf(source);
  const [d] = treeVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  return { tl, d };
}

/** `insert:root` — a variable by its function and name. */
export const qualified = (tl: Timeline, ref: VarRef) => `${tl.meta.fns[ref.fnId].name}:${ref.name}`;

export const fnNames = (tl: Timeline, fnIds: number[]) => fnIds.map((f) => tl.meta.fns[f].name);

/** Node label → model, for the nodes drawn at a step. */
export const byLabel = (nodes: NodeModel[]) => new Map(nodes.map((n) => [n.label, n]));
