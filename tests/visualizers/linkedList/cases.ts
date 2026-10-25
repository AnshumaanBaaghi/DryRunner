/** Linked-list sources and setup shared by the detector, model and HUD tests. */
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { linkedListVisualizer } from '../../../src/visualizers/linkedList';
import type { LinkedListBindings } from '../../../src/visualizers/linkedList/detect';
import type { NodeModel } from '../../../src/visualizers/linkedList/model';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

/** 1 ⇄ 2 ⇄ 3 ⇄ 4 built at the tail, then node 2 unlinked. */
export const DOUBLY = `class DNode {
  constructor(val) {
    this.val = val;
    this.prev = null;
    this.next = null;
  }
}
const head = new DNode(1);
let tail = head;
for (const v of [2, 3, 4]) {
  const node = new DNode(v);
  node.prev = tail;
  tail.next = node;
  tail = node;
}
const victim = head.next;
victim.prev.next = victim.next;
victim.next.prev = victim.prev;
`;

/** Every 6 removed from 1 → 6 → 2 → 6 → 3 behind a dummy head. */
export const DUMMY_HEAD = `class ListNode {
  constructor(val, next = null) {
    this.val = val;
    this.next = next;
  }
}
function removeElements(head, target) {
  const dummy = new ListNode(0, head);
  let curr = dummy;
  while (curr.next !== null) {
    if (curr.next.val === target) curr.next = curr.next.next;
    else curr = curr.next;
  }
  return dummy.next;
}
let head = new ListNode(1, new ListNode(6, new ListNode(2, new ListNode(6, new ListNode(3)))));
head = removeElements(head, 6);
`;

/** Plain-object nodes prepended (3, 2, 1), then walked. */
export const PLAIN_OBJECTS = `let head = null;
for (const v of [3, 2, 1]) head = { val: v, next: head };
let p = head;
let sum = 0;
while (p) {
  sum += p.val;
  p = p.next;
}
`;

/** 1 → 2 → 3 → 4 → back to 2, chased by slow / fast pointers. */
export const CYCLE = `const nodes = [1, 2, 3, 4].map((v) => ({ val: v, next: null }));
for (let k = 0; k < 3; k++) nodes[k].next = nodes[k + 1];
nodes[3].next = nodes[1];
let slow = nodes[0];
let fast = nodes[0];
while (fast && fast.next) {
  slow = slow.next;
  fast = fast.next.next;
  if (slow === fast) break;
}
`;

export const example = (id: string) => exampleById(id)!.code;

export async function setup(source: string): Promise<{ tl: Timeline; d: Detection<LinkedListBindings> }> {
  const tl = await timelineOf(source);
  const [d] = linkedListVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  return { tl, d };
}

export const bySlot = (nodes: NodeModel[]) => [...nodes].sort((a, b) => a.slot - b.slot);
