/** Backtracking detector: which recursion makes and undoes choices, in which mode, and what it records. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { detectBacktracking, type BacktrackBindings } from '../../../src/visualizers/backtracking/detect';
import { selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

async function detect(source: string): Promise<{ tl: Timeline; ds: Detection<BacktrackBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, ds: detectBacktracking({ tl, analysis: analyzeTrace(tl) }) };
}

const example = (id: string) => exampleById(id)!.code;
const fnId = (tl: Timeline, name: string) => tl.meta.fns.find((f) => f.name === name)!.id;
const objClaims = (d: Detection) => d.claims.filter((c) => c.startsWith('obj:'));

describe('backtracking detection', () => {
  it('n-queens: a board cell set and restored around each call, solutions collected outside', async () => {
    const { tl, ds } = await detect(example('n-queens'));
    expect(ds).toHaveLength(1);
    const [d] = ds;
    const place = fnId(tl, 'place');
    expect(d).toMatchObject({ vizId: 'backtracking', key: `backtracking:${place}`, title: 'place', mode: 'board', role: 'primary', score: 0.95 });
    expect(d.bindings.fnIds).toEqual([place]);
    expect(d.bindings.board?.name).toBe('board');
    expect(d.bindings.results?.name).toBe('solutions');
    expect(d.bindings.path).toBeUndefined();
    expect(d.bindings.flags).toBeUndefined();
    expect(d.claims).toEqual(expect.arrayContaining([`fn:${place}`, varKey(d.bindings.board!), varKey(d.bindings.results!)]));
    // the board, its four rows and the solutions list
    expect(objClaims(d)).toHaveLength(6);
  });

  it('subsets: a path pushed before each call and popped after it', async () => {
    const { tl, ds } = await detect(example('subsets'));
    const [d] = ds;
    expect(ds).toHaveLength(1);
    expect(d.mode).toBe('path');
    expect(d.title).toBe('backtrack');
    expect(d.bindings.fnIds).toEqual([fnId(tl, 'backtrack')]);
    expect(d.bindings.path?.name).toBe('path');
    expect(d.bindings.results?.name).toBe('result');
    expect(d.bindings.board).toBeUndefined();
    expect(d.claims).toEqual(expect.arrayContaining([`fn:${fnId(tl, 'backtrack')}`, varKey(d.bindings.path!), varKey(d.bindings.results!)]));
    expect(objClaims(d)).toHaveLength(2);
  });

  it('permutations: the path plus the used flags reset after each call', async () => {
    const { ds } = await detect(example('permutations'));
    const [d] = ds;
    expect(d.mode).toBe('path');
    expect(d.bindings.path?.name).toBe('path');
    expect(d.bindings.flags?.name).toBe('used');
    expect(d.bindings.results?.name).toBe('result');
    expect(d.claims).toContain(varKey(d.bindings.flags!));
    expect(objClaims(d)).toHaveLength(3);
  });

  it.each(['fibonacci', 'factorial', 'quick-sort', 'merge-sort', 'fibonacci-memo', 'dfs', 'islands', 'bst-traversals', 'max-depth'])(
    'finds nothing undone around the recursion in %s',
    async (id) => {
      expect((await detect(example(id))).ds).toEqual([]);
    },
  );

  it('flags mode: a visited Set added to before the call and deleted from after it', async () => {
    const { ds } = await detect(`const graph = { a: ['b', 'c'], b: ['c', 'd'], c: ['d'], d: [] };
const seen = new Set(['a']);
let count = 0;
function walk(node) {
  if (node === 'd') { count++; return; }
  for (const next of graph[node]) {
    if (seen.has(next)) continue;
    seen.add(next);
    walk(next);
    seen.delete(next);
  }
}
walk('a');`);
    const [d] = ds;
    expect(d.mode).toBe('flags');
    expect(d.title).toBe('walk');
    expect(d.bindings.flags?.name).toBe('seen');
    expect(d.bindings.results).toBeUndefined();
  });

  it('follows a path passed down as an argument and string results', async () => {
    const { tl, ds } = await detect(`const map = { 2: 'ab', 3: 'cd' };
const out = [];
function go(i, digits, path) {
  if (i === digits.length) { out.push(path.join('')); return; }
  for (const ch of map[digits[i]]) { path.push(ch); go(i + 1, digits, path); path.pop(); }
}
go(0, '23', []);`);
    const [d] = ds;
    expect(d.mode).toBe('path');
    expect(d.bindings.path).toMatchObject({ name: 'path', fnId: fnId(tl, 'go') });
    expect(d.bindings.results?.name).toBe('out');
  });

  it('ignores state passed by value (nothing to undo)', async () => {
    const { ds } = await detect(`const out = [];
function gen(s, open, close, n) {
  if (s.length === 2 * n) { out.push(s); return; }
  if (open < n) gen(s + '(', open + 1, close, n);
  if (close < open) gen(s + ')', open, close + 1, n);
}
gen('', 0, 0, 2);`);
    expect(ds).toEqual([]);
  });

  it('claims the recursive function ahead of the recursion tree', async () => {
    const { tl, ds } = await detect(example('subsets'));
    const fn = fnId(tl, 'backtrack');
    const rival: Detection = { vizId: 'recursionTree', key: 'recursionTree:x', title: 'backtrack', score: 0.8, role: 'primary', bindings: {}, claims: [`fn:${fn}`] };
    const chosen = selectDetections([...ds, rival]);
    expect(chosen.map((d) => d.vizId)).toEqual(['backtracking']);
  });
});
