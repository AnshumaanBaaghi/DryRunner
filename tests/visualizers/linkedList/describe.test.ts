/** Linked-list HUD lines: nodes created, links rewritten as the source names them, pointers moving. */
import { describe, expect, it } from 'vitest';
import { linkedListVisualizer } from '../../../src/visualizers/linkedList';
import { CYCLE, DOUBLY, DUMMY_HEAD, example, setup } from './cases';

/** Every non-empty HUD block of the run, in order. */
async function hud(source: string): Promise<string[][]> {
  const { tl, d } = await setup(source);
  const out: string[][] = [];
  for (let i = 0; i < tl.steps.length; i++) {
    const lines = linkedListVisualizer.describe!(tl, i, d);
    if (lines.length) out.push(lines);
  }
  expect(linkedListVisualizer.describe!(tl, 0, d)).toEqual([]);
  return out;
}

describe('linked list describe', () => {
  it('reverse-list: the list being built, every rewired link and pointer move, then the walk', async () => {
    const lines = (await hud(example('reverse-list'))).flat();
    // a new node's link starting out null is no news; one starting at the old head is
    expect(lines.slice(0, 4)).toEqual(['new node 5', 'head moves to 5', 'new node 4', 'node 4.next = 5']);
    const reversal = lines.slice(lines.indexOf('curr.next: 2 → null'));
    expect(reversal.slice(0, 7)).toEqual([
      'curr.next: 2 → null', 'prev moves to 1', 'curr moves to 2', 'next moves to 3', 'curr.next: 3 → 1', 'prev moves to 2', 'curr moves to 3',
    ]);
    expect(lines.filter((l) => l.startsWith('curr.next'))).toEqual([
      'curr.next: 2 → null', 'curr.next: 3 → 1', 'curr.next: 4 → 2', 'curr.next: 5 → 3', 'curr.next: null → 4',
    ]);
    expect(lines.slice(-5)).toEqual(['node moves to 4', 'node moves to 3', 'node moves to 2', 'node moves to 1', 'node moves to null']);
  });

  it('dummy head: skipping removed nodes', async () => {
    const lines = (await hud(DUMMY_HEAD)).flat();
    expect(lines).toContain('new node 0');
    expect(lines.filter((l) => l.startsWith('curr'))).toEqual([
      'curr moves to 1', 'curr.next: 6 → 2', 'curr moves to 2', 'curr.next: 6 → 3', 'curr moves to 3',
    ]);
  });

  it('names links written through property chains the way the source does', async () => {
    const lines = (await hud(DOUBLY)).flat();
    expect(lines).toEqual(expect.arrayContaining(['node.prev: null → 1', 'tail.next: null → 2', 'victim.prev.next: 2 → 3', 'victim.next.prev: 2 → 1']));
    const recursive = (await hud(`function reverse(head) {
  if (head === null || head.next === null) return head;
  const rest = reverse(head.next);
  head.next.next = head;
  head.next = null;
  return rest;
}
let list = { val: 1, next: { val: 2, next: { val: 3, next: null } } };
list = reverse(list);`)).flat();
    expect(recursive[0]).toBe('new nodes 3, 2, 1');
    expect(recursive.filter((l) => l.includes('.next'))).toEqual(['head.next.next: null → 2', 'head.next: 3 → null', 'head.next.next: null → 1', 'head.next: 2 → null']);
    expect(recursive.at(-1)).toBe('list moves to 3');
  });

  it('falls back to the node when the statement does not name it, and says when a write keeps the target', async () => {
    expect((await hud(CYCLE)).flat()).toContain('node 4.next: null → 2');
    expect((await hud('const a = { val: 1, next: null };\nconst b = { val: 2, next: null };\na.next = b;\na.next = b;')).flat()).toEqual([
      'new node 1', 'new node 2', 'a.next: null → 2', 'a.next stays 2',
    ]);
  });
});
