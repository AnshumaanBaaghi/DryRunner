/** Programs shared by the queue tests: every way of keeping a queue the detector knows, and look-alikes that aren't one. */

/** Examples without a queue (stacks, sorting, recursion, plain loops). */
export const NOT_QUEUE = [
  'valid-parentheses', 'next-greater', 'reverse-list', 'merge-sort', 'quick-sort', 'bubble-sort', 'subsets', 'two-sum-sorted', 'loop-sum',
];

/** BFS reading `queue[head++]` while pushing (the array is never shifted). */
export const HEAD_INDEX = `const graph = [[1, 2], [3], [3], []];
function bfs(start) {
  const queue = [start];
  const seen = new Set([start]);
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    for (const next of graph[node]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return queue;
}
bfs(0);`;

export const CLASS_QUEUE = `class Queue {
  constructor() {
    this.items = [];
  }
  enqueue(x) {
    this.items.push(x);
  }
  dequeue() {
    return this.items.shift();
  }
}
const q = new Queue();
q.enqueue(1);
q.enqueue(2);
q.dequeue();
q.enqueue(3);
q.dequeue();`;

/** Sliding-window maximum: a monotonic deque popped at the back and shifted at the front. */
export const DEQUE = `function maxSlidingWindow(nums, k) {
  const dq = [];
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    while (dq.length && dq[0] <= i - k) dq.shift();
    while (dq.length && nums[dq[dq.length - 1]] < nums[i]) dq.pop();
    dq.push(i);
    if (i >= k - 1) out.push(nums[dq[0]]);
  }
  return out;
}
maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3);`;

/** A FIFO filled with unshift and drained with pop: its front is the array's end. */
export const UNSHIFT_POP = `const line = [];
for (const x of [1, 2, 3]) line.unshift(x);
const out = [];
while (line.length) out.push(line.pop());`;

/** Last stone weight: a max-first priority queue re-sorted ascending and extracted with pop. */
export const SORT_POP = `function lastStone(stones) {
  const pq = [...stones];
  while (pq.length > 1) {
    pq.sort((a, b) => a - b);
    const y = pq.pop();
    const x = pq.pop();
    if (x !== y) pq.push(y - x);
  }
  return pq.length ? pq[0] : 0;
}
lastStone([2, 7, 4, 1, 8, 1]);`;
