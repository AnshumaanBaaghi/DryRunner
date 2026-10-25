/** Programs shared by the graph tests: the ways of keeping and walking a graph the detector knows, and look-alikes that aren't one. */
import { exampleById } from '../../../src/examples';

export const example = (id: string) => exampleById(id)!.code;

/** Examples without a graph: grids, DP tables, trees, lists, backtracking boards, sorting, two pointers. */
export const NOT_GRAPH = [
  'islands', 'lcs', 'edit-distance', 'knapsack', 'bst-traversals', 'max-depth', 'reverse-list', 'n-queens', 'merge-sort', 'two-sum-sorted',
];

/** Iterative DFS with an explicit stack and a `seen` Set (directed). */
export const STACK_DFS = `const graph = [[1, 2], [3], [3, 4], [5], [5], []];
function dfs(start) {
  const stack = [start];
  const seen = new Set();
  const order = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    order.push(node);
    for (const next of graph[node]) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  return order;
}
console.log(dfs(0));`;

/** BFS over a 0/1 adjacency matrix, scanning each row with a counter. */
export const MATRIX_BFS = `const adj = [
  [0, 1, 1, 0],
  [1, 0, 0, 1],
  [1, 0, 0, 1],
  [0, 1, 1, 0],
];
function bfs(start) {
  const n = adj.length;
  const visited = new Array(n).fill(false);
  const queue = [start];
  visited[start] = true;
  while (queue.length) {
    const u = queue.shift();
    for (let v = 0; v < n; v++) {
      if (adj[u][v] === 1 && !visited[v]) {
        visited[v] = true;
        queue.push(v);
      }
    }
  }
  return visited;
}
console.log(bfs(0));`;

/** Recursive DFS over a directed weighted-free matrix. */
export const MATRIX_DFS = `const m = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
const seen = [false, false, false];
function dfs(u) {
  seen[u] = true;
  for (let v = 0; v < m.length; v++) {
    if (m[u][v] && !seen[v]) dfs(v);
  }
}
dfs(0);
console.log(seen);`;

/** A Map adjacency built from an edge list of strings, walked by a top-level BFS. */
export const MAP_BFS = `const edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']];
const graph = new Map();
for (const [u, v] of edges) {
  if (!graph.has(u)) graph.set(u, []);
  if (!graph.has(v)) graph.set(v, []);
  graph.get(u).push(v);
  graph.get(v).push(u);
}
const visited = new Set(['a']);
const queue = ['a'];
while (queue.length) {
  const cur = queue.shift();
  for (const nb of graph.get(cur)) {
    if (!visited.has(nb)) {
      visited.add(nb);
      queue.push(nb);
    }
  }
}
console.log([...visited]);`;

/** Kahn's topological sort: the in-degree counters go down by one (no distances); edges built as b → a from [a, b]. */
export const KAHN = `function topoSort(n, prerequisites) {
  const adj = Array.from({ length: n }, () => []);
  const indegree = new Array(n).fill(0);
  for (const [a, b] of prerequisites) {
    adj[b].push(a);
    indegree[a]++;
  }
  const queue = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);
  const order = [];
  while (queue.length) {
    const u = queue.shift();
    order.push(u);
    for (const v of adj[u]) {
      indegree[v]--;
      if (indegree[v] === 0) queue.push(v);
    }
  }
  return order;
}
console.log(topoSort(4, [[1, 0], [2, 0], [3, 1], [3, 2]]));`;

/** BFS reading neighbors by index; levels start at -1 (a visited marker, not distances being lowered). */
export const INDEX_BFS = `const graph = [[1, 2], [0, 3], [0, 3], [1, 2]];
function bfs(s) {
  const dist = new Array(graph.length).fill(-1);
  dist[s] = 0;
  const q = [s];
  while (q.length) {
    const node = q.shift();
    for (let i = 0; i < graph[node].length; i++) {
      const next = graph[node][i];
      if (dist[next] === -1) {
        dist[next] = dist[node] + 1;
        q.push(next);
      }
    }
  }
  return dist;
}
console.log(bfs(0));`;

/** Recursive DFS through a forEach callback over an object with numeric keys. */
export const FOREACH_DFS = `const graph = { 1: [2, 3], 2: [4], 3: [4], 4: [] };
const visited = {};
function dfs(node) {
  visited[node] = true;
  graph[node].forEach((next) => {
    if (!visited[next]) dfs(next);
  });
}
dfs(1);
console.log(Object.keys(visited));`;

/** Unweighted shortest paths: distances start at Infinity and are lowered once each. */
export const BFS_DIST = `const graph = [[1, 2], [0, 3], [0, 3, 4], [1, 2, 5], [2, 5], [3, 4]];
function shortestPaths(src) {
  const dist = new Array(graph.length).fill(Infinity);
  dist[src] = 0;
  const queue = [src];
  while (queue.length > 0) {
    const u = queue.shift();
    for (const v of graph[u]) {
      if (dist[v] === Infinity) {
        dist[v] = dist[u] + 1;
        queue.push(v);
      }
    }
  }
  return dist;
}
console.log(shortestPaths(0));`;

/** The adjacency is a class field (\`this.adj\`), known through the instance's variable. */
export const CLASS_GRAPH = `class Graph {
  constructor(n) {
    this.adj = Array.from({ length: n }, () => []);
  }
  addEdge(u, v) {
    this.adj[u].push(v);
    this.adj[v].push(u);
  }
  bfs(s) {
    const seen = new Set([s]);
    const q = [s];
    while (q.length) {
      const u = q.shift();
      for (const v of this.adj[u]) {
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
      }
    }
    return [...seen];
  }
}
const g = new Graph(4);
g.addEdge(0, 1);
g.addEdge(1, 2);
g.addEdge(2, 3);
console.log(g.bfs(0));`;

/** A BFS whose queue is read through a head index (\`queue[head++]\`), never shifted. */
export const HEAD_BFS = `const graph = [[1, 2], [3], [3], []];
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

/** BFS on a square numeric grid: cells are (row, column) pairs, not matrix edges. */
export const GRID_BFS = `function shortest(grid) {
  const n = grid.length;
  const seen = Array.from({ length: n }, () => new Array(n).fill(false));
  const queue = [[0, 0, 1]];
  seen[0][0] = true;
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (queue.length) {
    const [r, c, d] = queue.shift();
    if (r === n - 1 && c === n - 1) return d;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nc >= 0 && nr < n && nc < n && grid[nr][nc] === 0 && !seen[nr][nc]) {
        seen[nr][nc] = true;
        queue.push([nr, nc, d + 1]);
      }
    }
  }
  return -1;
}
console.log(shortest([[0, 0, 0], [1, 1, 0], [0, 0, 0]]));`;

/** Nested arrays iterated with for-of but no traversal (no visited marks, frontier, recursion or distances). */
export const PAIRS_LOOP = `const pairs = [[1, 0], [0, 1]];
let total = 0;
for (let i = 0; i < pairs.length; i++) {
  for (const x of pairs[i]) total += x;
}
console.log(total);`;

/** Bellman-Ford over the edge list itself: each loop pass relaxes edge by edge. */
export const BELLMAN = `function bellmanFord(n, edges, src) {
  const dist = new Array(n).fill(Infinity);
  dist[src] = 0;
  for (let i = 0; i < n - 1; i++) {
    for (const [u, v, w] of edges) {
      if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
  }
  return dist;
}
console.log(bellmanFord(4, [[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1]], 0));`;

/** The same, reading each edge's fields by index in separate statements. */
export const BELLMAN_FIELDS = `function bellmanFord(n, edges, src) {
  const dist = new Array(n).fill(Infinity);
  dist[src] = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < edges.length; j++) {
      const u = edges[j][0];
      const v = edges[j][1];
      const w = edges[j][2];
      if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
  }
  return dist;
}
console.log(bellmanFord(4, [[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1]], 0));`;

/** Dijkstra taking each `[v, w]` pair apart inside the loop body, with a `done` Set. */
export const DIJKSTRA_BODY = `function dijkstra(adj, s) {
  const dist = adj.map(() => Infinity);
  dist[s] = 0;
  const done = new Set();
  const pq = [[0, s]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (done.has(u)) continue;
    done.add(u);
    for (const e of adj[u]) {
      const [v, w] = e;
      if (d + w < dist[v]) {
        dist[v] = d + w;
        pq.push([dist[v], v]);
      }
    }
  }
  return dist;
}
console.log(dijkstra([[[1, 2], [2, 5]], [[2, 1]], [[3, 1]], []], 0));`;
