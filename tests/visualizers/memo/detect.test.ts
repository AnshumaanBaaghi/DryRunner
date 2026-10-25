/** Memo detector: which recursion stores its results in a cache and reuses them, in which cache shape. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { memoVisualizer } from '../../../src/visualizers/memo';
import { detectMemo, type MemoBindings } from '../../../src/visualizers/memo/detect';
import { memoInfo } from '../../../src/visualizers/memo/model';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import { buildCallTree } from '../../../src/visualizers/shared/callTree';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

async function detect(source: string): Promise<{ tl: Timeline; ds: Detection<MemoBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, ds: detectMemo({ tl, analysis: analyzeTrace(tl) }) };
}

const example = (id: string) => exampleById(id)!.code;
const fnId = (tl: Timeline, name: string) => tl.meta.fns.find((f) => f.name === name)!.id;
const hitsOf = (tl: Timeline, d: Detection<MemoBindings>) => memoInfo(tl, buildCallTree(tl, d.bindings.fnIds), d.bindings).hitSteps.length;

const OBJECT_MEMO = `const memo = {};
function fib(n) {
  if (n in memo) return memo[n];
  if (n <= 1) return n;
  memo[n] = fib(n - 1) + fib(n - 2);
  return memo[n];
}
console.log(fib(6));`;

const ARRAY_MEMO = `function climb(n) {
  const dp = new Array(n + 1).fill(-1);
  function go(i) {
    if (i <= 1) return 1;
    if (dp[i] !== -1) return dp[i];
    dp[i] = go(i - 1) + go(i - 2);
    return dp[i];
  }
  return go(n);
}
console.log(climb(6));`;

const PARAM_MEMO = `function fib(n, memo = {}) {
  if (memo[n] !== undefined) return memo[n];
  if (n <= 1) return n;
  const res = fib(n - 1, memo) + fib(n - 2, memo);
  memo[n] = res;
  return res;
}
console.log(fib(6));`;

const TABLE_MEMO = `function uniquePaths(m, n) {
  const memo = Array.from({ length: m }, () => new Array(n).fill(0));
  function go(r, c) {
    if (r === 0 || c === 0) return 1;
    if (memo[r][c]) return memo[r][c];
    memo[r][c] = go(r - 1, c) + go(r, c - 1);
    return memo[r][c];
  }
  return go(m - 1, n - 1);
}
console.log(uniquePaths(3, 4));`;

const STRING_KEYS = `function lcs(a, b) {
  const memo = new Map();
  function go(i, j) {
    if (i === a.length || j === b.length) return 0;
    const key = i + ',' + j;
    if (memo.has(key)) return memo.get(key);
    const best = a[i] === b[j] ? 1 + go(i + 1, j + 1) : Math.max(go(i + 1, j), go(i, j + 1));
    memo.set(key, best);
    return best;
  }
  return go(0, 0);
}
console.log(lcs('abc', 'cab'));`;

describe('memo detection', () => {
  it('fibonacci-memo: fib stores its results in the memo Map and reuses them', async () => {
    const { tl, ds } = await detect(example('fibonacci-memo'));
    expect(ds).toHaveLength(1);
    const [d] = ds;
    const fib = fnId(tl, 'fib');
    expect(d).toMatchObject({ vizId: 'memo', key: `memo:${fib}`, title: 'fib', role: 'primary', score: 0.95 });
    expect(d.bindings.fnIds).toEqual([fib]);
    expect(d.bindings.cache).toMatchObject({ name: 'memo', fnId: 0 });
    expect(d.bindings.kind).toBe('map');
    expect(hitsOf(tl, d)).toBeGreaterThan(0);
    const objs = d.claims.filter((c) => c.startsWith('obj:'));
    expect(objs).toHaveLength(1);
    expect(d.claims).toEqual(expect.arrayContaining([`fn:${fib}`, varKey(d.bindings.cache)]));
  });

  it('replaces the recursion tree as the primary view; the call stack stays', async () => {
    const tl = await timelineOf(example('fibonacci-memo'));
    const plugins = [...visualizers().filter((v) => v.id !== 'memo'), memoVisualizer];
    const { all, errors } = detectAll(tl, plugins);
    expect(errors).toEqual([]);
    expect(all.some((d) => d.vizId === 'recursionTree')).toBe(true);
    const chosen = selectDetections(all);
    expect(chosen.find((d) => d.role === 'primary')?.vizId).toBe('memo');
    expect(chosen.map((d) => d.vizId)).toContain('callStack');
    expect(chosen.map((d) => d.vizId)).not.toContain('recursionTree');
  });

  it.each(['fibonacci', 'factorial', 'climbing-stairs', 'n-queens', 'subsets', 'permutations', 'quick-sort', 'merge-sort', 'dfs',
    'islands', 'max-depth', 'bst-traversals'])('finds no cache reused in %s', async (id) => {
    expect((await detect(example(id))).ds).toEqual([]);
  });

  it.each([
    ['a plain object (`n in memo`)', OBJECT_MEMO, 'fib', 'memo', 'object'],
    ['an array with a sentinel', ARRAY_MEMO, 'go', 'dp', 'array'],
    ['a memo passed down as a parameter', PARAM_MEMO, 'fib', 'memo', 'object'],
    ['a 2D table', TABLE_MEMO, 'go', 'memo', 'table'],
    ['a Map with string keys', STRING_KEYS, 'go', 'memo', 'map'],
  ])('recognizes %s', async (_, source, fn, cache, kind) => {
    const { tl, ds } = await detect(source);
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(d.bindings.fnIds).toEqual([fnId(tl, fn)]);
    expect(d.bindings.cache.name).toBe(cache);
    expect(d.bindings.kind).toBe(kind);
    expect(hitsOf(tl, d)).toBeGreaterThan(0);
  });

  it('claims a 2D table with its rows', async () => {
    const { ds } = await detect(TABLE_MEMO);
    // the outer array and its three rows
    expect(ds[0].claims.filter((c) => c.startsWith('obj:'))).toHaveLength(4);
  });

  it('needs a reuse: a memo that is never hit stays a recursion tree', async () => {
    const { ds } = await detect(`const memo = new Map();
function fib(n) {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n);
  const v = fib(n - 1) + fib(n - 2);
  memo.set(n, v);
  return v;
}
fib(3);`);
    expect(ds).toEqual([]);
  });

  it('ignores union-find path compression (roots are read, never stored)', async () => {
    const { ds } = await detect(`const parent = [0, 0, 1, 2, 3];
function find(x) {
  if (parent[x] === x) return x;
  parent[x] = find(parent[x]);
  return parent[x];
}
find(4);
find(3);
find(4);`);
    expect(ds).toEqual([]);
  });

  it('ignores a segment tree: entries a call writes and reads back are no hits', async () => {
    const { ds } = await detect(`const arr = [1, 3, 5, 7];
const tree = new Array(16).fill(0);
function build(node, l, r) {
  if (l === r) {
    tree[node] = arr[l];
    return tree[node];
  }
  const m = (l + r) >> 1;
  tree[node] = build(2 * node, l, m) + build(2 * node + 1, m + 1, r);
  return tree[node];
}
function update(node, l, r, i, v) {
  if (l === r) {
    tree[node] = v;
    return tree[node];
  }
  const m = (l + r) >> 1;
  if (i <= m) update(2 * node, l, m, i, v);
  else update(2 * node + 1, m + 1, r, i, v);
  tree[node] = tree[2 * node] + tree[2 * node + 1];
  return tree[node];
}
function query(node, l, r, ql, qr) {
  if (qr < l || r < ql) return 0;
  if (ql <= l && r <= qr) return tree[node];
  const m = (l + r) >> 1;
  return query(2 * node, l, m, ql, qr) + query(2 * node + 1, m + 1, r, ql, qr);
}
build(1, 0, 3);
update(1, 0, 3, 2, 10);
query(1, 0, 3, 1, 3);`);
    expect(ds).toEqual([]);
  });

  it('ignores a result kept on each node (one entry per object is no cache)', async () => {
    const { ds } = await detect(`const leaf = { kids: [] };
const mid = { kids: [leaf, leaf] };
const root = { kids: [mid, mid] };
function height(node) {
  if (node.h !== undefined) return node.h;
  let best = 0;
  for (const k of node.kids) best = Math.max(best, 1 + height(k));
  node.h = best;
  return node.h;
}
height(root);`);
    expect(ds).toEqual([]);
  });

  it('claims the recursive function ahead of the recursion tree', async () => {
    const { tl, ds } = await detect(example('fibonacci-memo'));
    const rival: Detection = {
      vizId: 'recursionTree', key: 'recursionTree:x', title: 'fib', score: 0.8, role: 'primary', bindings: {}, claims: [`fn:${fnId(tl, 'fib')}`],
    };
    expect(selectDetections([...ds, rival]).map((d) => d.vizId)).toEqual(['memo']);
  });
});
