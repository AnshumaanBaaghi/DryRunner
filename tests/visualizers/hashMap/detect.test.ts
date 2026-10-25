/** Hash-map detector: which Maps, Sets and dynamically keyed objects get a panel, and the variable naming them. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { hashMapVisualizer } from '../../../src/visualizers/hashMap';
import { detectHashMaps, type HashMapBindings } from '../../../src/visualizers/hashMap/detect';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';

async function detect(source: string): Promise<{ tl: Timeline; ds: Detection<HashMapBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, ds: detectHashMaps({ tl, analysis: analyzeTrace(tl) }) };
}

/** What the stage shows with this plugin registered alongside the others. */
async function shown(source: string): Promise<Detection[]> {
  const tl = await timelineOf(source);
  const plugins = [...visualizers().filter((v) => v.id !== 'hashMap'), hashMapVisualizer];
  const { all, errors } = detectAll(tl, plugins);
  expect(errors).toEqual([]);
  return selectDetections(all);
}

const example = (id: string) => exampleById(id)!.code;
const kindOf = (tl: Timeline, d: Detection<HashMapBindings>) => tl.snapshots[tl.snapshots.length - 1].heap.get(d.bindings.objId)?.kind;

describe('hash map detection', () => {
  it.each([
    ['longest-substring', 'lastSeen', 'map'],
    ['bfs', 'visited', 'set'],
    ['dfs', 'visited', 'set'],
  ])('%s: %s, a %s', async (id, name, kind) => {
    const { tl, ds } = await detect(example(id));
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(kindOf(tl, d)).toBe(kind);
    expect(d).toMatchObject({ vizId: 'hashMap', key: `hashMap:${d.bindings.objId}`, title: name, score: 0.7, role: 'aux', side: 'left' });
    expect(d.bindings).toMatchObject({ kind, target: { name } });
    expect(d.claims).toEqual([`obj:${d.bindings.objId}`, varKey(d.bindings.target)]);
  });

  it.each(['loop-sum', 'two-sum-sorted', 'binary-search', 'bubble-sort', 'reverse-list', 'n-queens', 'bst-traversals', 'max-depth',
    'nested-pairs', 'climbing-stairs', 'lcs', 'dijkstra', 'queue-simulation'])('finds nothing in %s', async (id) => {
    expect((await detect(example(id))).ds).toEqual([]);
  });

  it('valid-parentheses: a lookup literal never modified after its creation stays out', async () => {
    const { tl, ds } = await detect(example('valid-parentheses'));
    expect(ds).toEqual([]);
    const pairs = [...analyzeTrace(tl).objects.values()].find((o) => o.varKeys.has(`${tl.meta.fns.find((f) => f.name === 'isValid')!.id}:pairs`));
    expect(pairs).toMatchObject({ kind: 'object', ops: {} });
    expect(pairs!.reads).toBeGreaterThan(1);
  });

  it('shows next to the primary view as an aux panel', async () => {
    expect((await shown(example('longest-substring'))).map((d) => `${d.vizId}:${d.role}`)).toEqual(['array:primary', 'hashMap:aux']);
    expect((await shown(example('bfs'))).map((d) => `${d.vizId}:${d.title}:${d.role}`)).toContain('hashMap:visited:aux');
    expect((await shown(example('dfs'))).map((d) => d.vizId)).toEqual(expect.arrayContaining(['hashMap', 'callStack']));
  });

  it('fibonacci-memo: the memo plugin keeps its cache; no separate hash-map panel', async () => {
    const { ds } = await detect(example('fibonacci-memo'));
    expect(ds.map((d) => d.title)).toEqual(['memo']);
    const chosen = await shown(example('fibonacci-memo'));
    expect(chosen.find((d) => d.role === 'primary')?.vizId).toBe('memo');
    expect(chosen.map((d) => d.vizId)).not.toContain('hashMap');
  });

  it('plain objects with dynamic keys count; class instances and objects written at one key do not', async () => {
    const { ds } = await detect(`const count = {};
for (const ch of 'abca') count[ch] = (count[ch] || 0) + 1;
const box = { value: 0, label: 'x' };
box.value = 1;
box.value = 2;
class Pair {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
const p = new Pair(1, 2);
p.a = 3;
p.b = 4;`);
    expect(ds.map((d) => `${d.title}:${d.bindings.kind}`)).toEqual(['count:object']);
  });

  it('a Map or Set counts once modified or read twice; created and left alone it does not', async () => {
    const { ds } = await detect(`const idle = new Map([[1, 'a']]);
const once = new Set([1]);
once.has(1);
const lookup = new Map([['x', 1], ['y', 2]]);
lookup.get('x');
lookup.has('z');
const added = new Set();
added.add(3);
const cleared = new Map([[1, 2]]);
cleared.clear();`);
    expect(ds.map((d) => `${d.title}:${d.bindings.kind}`)).toEqual(['lookup:map', 'added:set', 'cleared:map']);
  });

  it('one detection per object; a helper parameter naming both maps hides neither', async () => {
    const source = `function bump(map, k) {
  map.set(k, (map.get(k) ?? 0) + 1);
}
const a = new Map();
const b = new Map();
bump(a, 'x');
bump(b, 'y');`;
    const { ds } = await detect(source);
    expect(ds.map((d) => d.title)).toEqual(['a', 'b']);
    expect(ds.every((d) => d.claims.length === 2 && !d.claims.some((c) => c.endsWith(':map')))).toBe(true);
    expect((await shown(source)).filter((d) => d.vizId === 'hashMap').map((d) => d.title)).toEqual(['a', 'b']);
  });

  it('a Set made in every loop iteration: one panel for its variable', async () => {
    const source = `function distinctRows(board) {
  for (const row of board) {
    const seen = new Set();
    for (const v of row) {
      if (seen.has(v)) return false;
      seen.add(v);
    }
  }
  return true;
}
distinctRows([[1, 2], [3, 4]]);`;
    const { ds } = await detect(source);
    expect(ds.map((d) => d.title)).toEqual(['seen', 'seen']);
    expect((await shown(source)).filter((d) => d.vizId === 'hashMap')).toHaveLength(1);
  });

  it('names a map passed down a recursion by its parameter', async () => {
    const { ds } = await detect(`function walk(n, seen) {
  if (n === 0 || seen.has(n)) return;
  seen.add(n);
  walk(n - 1, seen);
}
walk(3, new Set());`);
    expect(ds).toHaveLength(1);
    expect(ds[0].bindings).toMatchObject({ kind: 'set', target: { name: 'seen' } });
  });
});
