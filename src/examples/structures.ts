import type { Example } from './types';

export const STRUCTURE_EXAMPLES: Example[] = [
  {
    id: 'bst-traversals',
    title: 'BST insert + traversals',
    category: 'Trees',
    expect: { primary: 'tree', also: ['queue'] },
    code: `class TreeNode {
  constructor(val) {
    this.val = val;
    this.left = null;
    this.right = null;
  }
}

function insert(root, val) {
  if (root === null) return new TreeNode(val);
  if (val < root.val) root.left = insert(root.left, val);
  else root.right = insert(root.right, val);
  return root;
}

function inorder(node, out) {
  if (!node) return out;
  inorder(node.left, out);
  out.push(node.val);
  inorder(node.right, out);
  return out;
}

function preorder(node, out) {
  if (!node) return out;
  out.push(node.val);
  preorder(node.left, out);
  preorder(node.right, out);
  return out;
}

function levelOrder(root) {
  const result = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    result.push(node.val);
    if (node.left) queue.push(node.left);
    if (node.right) queue.push(node.right);
  }
  return result;
}

let root = null;
for (const v of [8, 3, 10, 1, 6, 14, 4]) root = insert(root, v);
console.log('inorder', inorder(root, []));
console.log('preorder', preorder(root, []));
console.log('level order', levelOrder(root));
`,
  },
  {
    id: 'max-depth',
    title: 'Max depth of a binary tree',
    category: 'Trees',
    expect: { primary: 'tree', also: ['callStack'] },
    code: `class TreeNode {
  constructor(val, left = null, right = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}

function maxDepth(node) {
  if (node === null) return 0;
  const left = maxDepth(node.left);
  const right = maxDepth(node.right);
  return 1 + Math.max(left, right);
}

const root = new TreeNode(3, new TreeNode(9), new TreeNode(20, new TreeNode(15), new TreeNode(7)));
console.log(maxDepth(root));
`,
  },
  {
    id: 'bfs',
    title: 'BFS on an adjacency list',
    category: 'Graphs',
    expect: { primary: 'graph', also: ['queue', 'hashMap'] },
    code: `const graph = [[1, 2], [0, 3, 4], [0, 4], [1, 5], [1, 2, 5], [3, 4]];

function bfs(start) {
  const visited = new Set([start]);
  const queue = [start];
  const order = [];
  while (queue.length > 0) {
    const node = queue.shift();
    order.push(node);
    for (const next of graph[node]) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return order;
}
console.log(bfs(0));
`,
  },
  {
    id: 'dfs',
    title: 'DFS on an adjacency list',
    category: 'Graphs',
    expect: { primary: 'graph', also: ['callStack'] },
    code: `const graph = { A: ['B', 'C'], B: ['D', 'E'], C: ['F'], D: [], E: ['F'], F: [] };
const visited = new Set();
const order = [];

function dfs(node) {
  visited.add(node);
  order.push(node);
  for (const next of graph[node]) {
    if (!visited.has(next)) dfs(next);
  }
}

dfs('A');
console.log(order);
`,
  },
  {
    id: 'dijkstra',
    title: "Dijkstra's shortest paths",
    category: 'Graphs',
    expect: { primary: 'graph', also: ['queue'], mode: 'distances' },
    code: `function dijkstra(n, edges, source) {
  const adj = Array.from({ length: n }, () => []);
  for (const [u, v, w] of edges) {
    adj[u].push([v, w]);
    adj[v].push([u, w]);
  }
  const dist = new Array(n).fill(Infinity);
  dist[source] = 0;
  const pq = [[0, source]];
  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (d > dist[u]) continue;
    for (const [v, w] of adj[u]) {
      if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        pq.push([dist[v], v]);
      }
    }
  }
  return dist;
}
console.log(dijkstra(5, [[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1], [2, 3, 5], [3, 4, 3]], 0));
`,
  },
  {
    id: 'islands',
    title: 'Number of islands (grid graph)',
    category: 'Graphs',
    expect: { primary: 'gridGraph', also: ['callStack'] },
    code: `function numIslands(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  let count = 0;

  function sink(r, c) {
    if (r < 0 || c < 0 || r >= rows || c >= cols || grid[r][c] !== '1') return;
    grid[r][c] = '0';
    sink(r + 1, c);
    sink(r - 1, c);
    sink(r, c + 1);
    sink(r, c - 1);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === '1') {
        count++;
        sink(r, c);
      }
    }
  }
  return count;
}
console.log(numIslands([
  ['1', '1', '0', '0', '0'],
  ['1', '1', '0', '0', '0'],
  ['0', '0', '1', '0', '0'],
  ['0', '0', '0', '1', '1'],
]));
`,
  },
  {
    id: 'valid-parentheses',
    title: 'Valid parentheses',
    category: 'Stacks',
    expect: { primary: 'stack' },
    code: `function isValid(s) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (stack.length === 0 || stack.pop() !== pairs[ch]) {
      return false;
    }
  }
  return stack.length === 0;
}
console.log(isValid('({[]})[]'));
`,
  },
  {
    id: 'next-greater',
    title: 'Next greater element (monotonic stack)',
    category: 'Stacks',
    expect: { primary: 'stack', mode: 'monotonic' },
    code: `function nextGreater(nums) {
  const result = new Array(nums.length).fill(-1);
  const stack = [];
  for (let i = 0; i < nums.length; i++) {
    while (stack.length > 0 && nums[stack[stack.length - 1]] < nums[i]) {
      const idx = stack.pop();
      result[idx] = nums[i];
    }
    stack.push(i);
  }
  return result;
}
console.log(nextGreater([2, 1, 2, 4, 3]));
`,
  },
  {
    id: 'queue-simulation',
    title: 'Queue simulation',
    category: 'Queues',
    expect: { primary: 'queue' },
    code: `const queue = [];
const served = [];
const arrivals = ['Ana', 'Ben', 'Cai', 'Dee'];
for (let t = 0; t < 6; t++) {
  if (t < arrivals.length) queue.push(arrivals[t]);
  if (t % 2 === 1 && queue.length > 0) served.push(queue.shift());
}
while (queue.length > 0) served.push(queue.shift());
console.log(served);
`,
  },
  {
    id: 'longest-substring',
    title: 'Longest substring without repeats (sliding window)',
    category: 'Arrays & windows',
    expect: { primary: 'array', also: ['hashMap'], mode: 'window' },
    code: `function lengthOfLongestSubstring(s) {
  const lastSeen = new Map();
  let left = 0;
  let best = 0;
  for (let right = 0; right < s.length; right++) {
    const ch = s[right];
    if (lastSeen.has(ch) && lastSeen.get(ch) >= left) {
      left = lastSeen.get(ch) + 1;
    }
    lastSeen.set(ch, right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}
console.log(lengthOfLongestSubstring('abcabcbb'));
`,
  },
  {
    id: 'two-sum-sorted',
    title: 'Two-sum on a sorted array (two pointers)',
    category: 'Arrays & windows',
    expect: { primary: 'array', mode: 'two-pointers' },
    code: `function twoSum(numbers, target) {
  let left = 0;
  let right = numbers.length - 1;
  while (left < right) {
    const sum = numbers[left] + numbers[right];
    if (sum === target) return [left, right];
    if (sum < target) left++;
    else right--;
  }
  return [-1, -1];
}
console.log(twoSum([1, 3, 4, 6, 8, 11, 15], 14));
`,
  },
  {
    id: 'binary-search',
    title: 'Binary search',
    category: 'Arrays & windows',
    expect: { primary: 'array', mode: 'binary-search' },
    code: `function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
console.log(binarySearch([2, 5, 8, 12, 16, 23, 38, 56, 72, 91], 23));
`,
  },
  {
    id: 'reverse-list',
    title: 'Reverse a linked list',
    category: 'Linked lists',
    expect: { primary: 'linkedList' },
    code: `class ListNode {
  constructor(val, next = null) {
    this.val = val;
    this.next = next;
  }
}

function reverseList(head) {
  let prev = null;
  let curr = head;
  while (curr !== null) {
    const next = curr.next;
    curr.next = prev;
    prev = curr;
    curr = next;
  }
  return prev;
}

let head = null;
for (const v of [5, 4, 3, 2, 1]) head = new ListNode(v, head);
let node = reverseList(head);
const values = [];
while (node) {
  values.push(node.val);
  node = node.next;
}
console.log(values);
`,
  },
  {
    id: 'bubble-sort',
    title: 'Bubble sort',
    category: 'Sorting',
    expect: { primary: 'array', mode: 'sorting' },
    code: `function bubbleSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
      }
    }
  }
  return arr;
}
console.log(bubbleSort([5, 1, 4, 2, 8, 3]));
`,
  },
  {
    id: 'quick-sort',
    title: 'Quick sort',
    category: 'Sorting',
    expect: { primary: 'array', also: ['recursionTree'], mode: 'sorting' },
    code: `function quickSort(arr, lo = 0, hi = arr.length - 1) {
  if (lo >= hi) return arr;
  const pivot = arr[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (arr[j] < pivot) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      i++;
    }
  }
  [arr[i], arr[hi]] = [arr[hi], arr[i]];
  quickSort(arr, lo, i - 1);
  quickSort(arr, i + 1, hi);
  return arr;
}
console.log(quickSort([7, 2, 9, 4, 3, 8, 6, 1]));
`,
  },
  {
    id: 'merge-sort',
    title: 'Merge sort',
    category: 'Sorting',
    expect: { primary: 'recursionTree', mode: 'divide-and-conquer' },
    code: `function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return merge(left, right);
}

function merge(left, right) {
  const result = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) result.push(left[i++]);
    else result.push(right[j++]);
  }
  while (i < left.length) result.push(left[i++]);
  while (j < right.length) result.push(right[j++]);
  return result;
}
console.log(mergeSort([38, 27, 43, 3, 9, 82, 10]));
`,
  },
];
