/** Linked-list detection: node shapes, value and link keys, pointer variables, and what is not a list. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import { linkedListVisualizer } from '../../../src/visualizers/linkedList';
import type { LinkedListBindings } from '../../../src/visualizers/linkedList/detect';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import { CYCLE, DOUBLY, DUMMY_HEAD, example, PLAIN_OBJECTS } from './cases';

async function lists(source: string): Promise<Detection<LinkedListBindings>[]> {
  const tl = await timelineOf(source);
  return linkedListVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
}

const names = (d: Detection<LinkedListBindings>) => d.bindings.pointers.map((p) => p.name);

describe('linked list detection', () => {
  it('reverse-list: ListNode nodes linked by next, the traversal pointers, titled after head', async () => {
    const [d, ...rest] = await lists(example('reverse-list'));
    expect(rest).toHaveLength(0);
    expect(d).toMatchObject({ vizId: 'linkedList', key: 'linkedList:ListNode', title: 'head', score: 0.9, role: 'primary' });
    const b = d.bindings;
    expect(b).toMatchObject({ nodeShape: 'ListNode', valueKey: 'val', nextKey: 'next' });
    expect(b.prevKey).toBeUndefined();
    expect(b.nodeIds).toHaveLength(5);
    // the global head, reverseList's head parameter, its pointers, then the walk over the result
    expect(names(d)).toEqual(['head', 'head', 'prev', 'curr', 'next', 'node']);
    expect(b.titleVar).toEqual(b.pointers[0]);
    expect(d.claims).toEqual([...b.nodeIds.map((id) => `obj:${id}`), ...b.pointers.map(varKey)]);
  });

  it('is what reverse-list shows first', async () => {
    const tl = await timelineOf(example('reverse-list'));
    const plugins = [...visualizers().filter((p) => p.id !== 'linkedList'), linkedListVisualizer];
    const [primary] = selectDetections(detectAll(tl, plugins).all);
    expect(primary.vizId).toBe('linkedList');
    expect(primary.role).toBe('primary');
  });

  it('a doubly linked list gets prev as its second link', async () => {
    const [d] = await lists(DOUBLY);
    expect(d.bindings).toMatchObject({ nodeShape: 'DNode', valueKey: 'val', nextKey: 'next', prevKey: 'prev' });
    expect(names(d)).toEqual(['head', 'tail', 'node', 'victim']);
    expect(d.title).toBe('head');
  });

  it('a dummy head is one more node, and a pointer', async () => {
    const [d] = await lists(DUMMY_HEAD);
    expect(d.bindings.nodeIds).toHaveLength(6);
    expect(names(d)).toEqual(['head', 'head', 'dummy', 'curr']);
    expect(d.title).toBe('head');
  });

  it('plain-object nodes share a shape by their property names', async () => {
    const [d] = await lists(PLAIN_OBJECTS);
    expect(d.key).toBe('linkedList:{val}');
    expect(d.bindings.nodeIds).toHaveLength(3);
    expect(names(d)).toEqual(['head', 'p']);
  });

  it('without a head-like pointer: a list wrapper names it, else the first pointer', async () => {
    const [wrapped] = await lists(`class Node {
  constructor(val) {
    this.val = val;
    this.next = null;
  }
}
class LinkedList {
  constructor() {
    this.head = null;
  }
  append(val) {
    const node = new Node(val);
    if (!this.head) {
      this.head = node;
      return;
    }
    let curr = this.head;
    while (curr.next) curr = curr.next;
    curr.next = node;
  }
}
const list = new LinkedList();
for (const v of [1, 2, 3]) list.append(v);`);
    expect(wrapped.title).toBe('list');
    expect(names(wrapped)).toEqual(['node', 'curr']);
    const [cycle] = await lists(CYCLE);
    expect(cycle.title).toBe('slow');
  });

  it('values come from the first plain property when none is named val / value / data / key', async () => {
    const [d] = await lists(`const c = { random: null, label: 'c', next: null };
const b = { random: c, label: 'b', next: c };
const a = { random: b, label: 'a', next: b };
c.random = a;`);
    // `random` links nodes, so it is no value
    expect(d.bindings.valueKey).toBe('label');
    expect(d.bindings.nodeIds).toHaveLength(3);
  });

  it('tree nodes are no list, even with a next pointer', async () => {
    expect(await lists(`class Node {
  constructor(val) {
    this.val = val;
    this.left = null;
    this.right = null;
    this.next = null;
  }
}
const root = new Node(1);
root.left = new Node(2);
root.right = new Node(3);
root.left.next = root.right;`)).toEqual([]);
  });

  it('nodes never linked to each other are no list', async () => {
    expect(await lists('class N {\n  constructor(v) {\n    this.val = v;\n    this.next = null;\n  }\n}\nconst a = new N(1);\nconst b = new N(2);')).toEqual([]);
  });

  it.each(['bst-traversals', 'max-depth', 'loop-sum', 'fibonacci', 'bfs', 'dfs', 'valid-parentheses', 'queue-simulation', 'two-sum-sorted'])(
    'finds no list in %s',
    async (id) => {
      expect(await lists(example(id))).toEqual([]);
    },
  );
});
