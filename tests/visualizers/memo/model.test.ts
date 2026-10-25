/** Memo model: each call's cache hit or stored result, node labels and looks, and the cache panel per step. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { detectMemo, type MemoBindings } from '../../../src/visualizers/memo/detect';
import {
  buildCache, CARD_CAP, cacheExtent, ENTRY_COLOR, finalBadge, memoInfo, nodeLook, nodeTexts, nodeWidth, type MemoInfo,
} from '../../../src/visualizers/memo/model';
import { cacheLayout, slotCenter } from '../../../src/visualizers/memo/panel';
import { buildCallTree, type CallTree, type TreeNode } from '../../../src/visualizers/shared/callTree';
import { timelineOf } from '../../helpers/timeline';

interface Setup {
  tl: Timeline;
  b: MemoBindings;
  tree: CallTree;
  info: MemoInfo;
}

async function setup(source: string): Promise<Setup> {
  const tl = await timelineOf(source);
  const [d] = detectMemo({ tl, analysis: analyzeTrace(tl) });
  const tree = buildCallTree(tl, d.bindings.fnIds);
  return { tl, b: d.bindings, tree, info: memoInfo(tl, tree, d.bindings) };
}

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** stepping back from i + 1 to i: the undone step's changes */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });

const nodes = (s: Setup) => [...s.tree.nodes.values()];
const labelOf = (s: Setup, n: TreeNode) => nodeTexts(s.tl, s.tree, s.info).labels.get(n.callId);
const hitNodes = (s: Setup) => nodes(s).filter((n) => s.info.calls.get(n.callId)?.hit);
const storedNodes = (s: Setup) => nodes(s).filter((n) => s.info.calls.get(n.callId)?.stored);
const cards = (s: Setup, i: number, hl: Highlight | null = null) => buildCache(s.tl, i, s.b, s.info, hl).cards.map((c) => c.text);

/** In-progress marker: the result overwrites a placeholder, so every store updates an existing entry. */
const PLACEHOLDER = `const memo = new Map();
function f(n) {
  if (n <= 1) return 1;
  if (memo.has(n)) return memo.get(n);
  memo.set(n, 0);
  const v = f(n - 1) + f(n - 2);
  memo.set(n, v);
  return v;
}
f(5);`;

const MANY = `const memo = new Map();
function fib(n) {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n);
  const v = fib(n - 1) + fib(n - 2);
  memo.set(n, v);
  return v;
}
fib(20);
fib(3);`;

describe('memo calls', () => {
  it('fibonacci-memo: right children hit the cache, every call above the base cases stores its result', async () => {
    const s = await setup(exampleById('fibonacci-memo')!.code);
    expect(hitNodes(s).map((n) => labelOf(s, n))).toEqual(['fib(2)', 'fib(3)', 'fib(4)', 'fib(5)', 'fib(6)']);
    expect(hitNodes(s).every((n) => n.children.length === 0 && s.tree.nodes.get(n.parent!)!.children[1] === n.callId)).toBe(true);
    expect(storedNodes(s).map((n) => labelOf(s, n))).toEqual(['fib(8)', 'fib(7)', 'fib(6)', 'fib(5)', 'fib(4)', 'fib(3)', 'fib(2)']);
    const base = nodes(s).filter((n) => !s.info.calls.has(n.callId));
    expect(base.map((n) => labelOf(s, n))).toEqual(['fib(1)', 'fib(0)', 'fib(1)']);

    // the hit is found by memo.has(n) and read by memo.get(n) at the return
    const hit = s.info.calls.get(hitNodes(s)[0].callId)!.hit!;
    expect(s.tl.diffs[hit.step].reads).toEqual([expect.objectContaining({ op: 'has', key: 2, value: true })]);
    expect(hit.reads).toEqual([hit.step, hit.step + 1]);
    expect(s.tl.steps[hit.step + 1].kind).toBe('return');
    expect(hit.value).toBe(1);
    // the store is memo.set(n, value), before the return
    const top = s.info.calls.get(s.tree.roots[0])!.stored!;
    expect(s.tl.diffs[top.step].heap).toEqual([expect.objectContaining({ op: 'mapSet', key: 8, value: 21 })]);
    expect(top.step).toBeLessThan(s.tree.nodes.get(s.tree.roots[0])!.returnStep!);
    expect(s.info.hitSteps).toHaveLength(5);
    expect([...s.info.hitAt.keys()]).toEqual(s.info.hitSteps);
  });

  it('a base case storing its value and reading it back is a store, not a hit', async () => {
    const s = await setup(`const memo = {};
function fib(n) {
  if (memo[n] !== undefined) return memo[n];
  if (n <= 1) {
    memo[n] = n;
    return memo[n];
  }
  memo[n] = fib(n - 1) + fib(n - 2);
  return memo[n];
}
fib(5);`);
    expect(hitNodes(s).map((n) => labelOf(s, n))).toEqual(['fib(1)', 'fib(2)', 'fib(3)']);
    const [first] = nodes(s).filter((n) => n.args[0] === 1);
    expect(s.info.calls.get(first.callId)).toEqual({ stored: expect.objectContaining({ key: '1', value: 1 }) });
  });

  it('labels calls, naming a memo that is passed along', async () => {
    const s = await setup(`function fib(n, memo = {}) {
  if (memo[n] !== undefined) return memo[n];
  if (n <= 1) return n;
  memo[n] = fib(n - 1, memo) + fib(n - 2, memo);
  return memo[n];
}
fib(5);`);
    expect(nodes(s).slice(0, 3).map((n) => labelOf(s, n))).toEqual(['fib(5, memo)', 'fib(4, memo)', 'fib(3, memo)']);
    expect(hitNodes(s).map((n) => labelOf(s, n))).toEqual(['fib(2, memo)', 'fib(3, memo)']);
  });

  it('looks: violet "cached" from the lookup on, a result orange once stored and green once returned', async () => {
    const s = await setup(exampleById('fibonacci-memo')!.code);
    const hitNode = hitNodes(s)[0];
    const hm = s.info.calls.get(hitNode.callId);
    const before = nodeLook('active', hitNode, hm!.hit!.step - 1, hm, 'fib(2)', '1');
    expect(before).toMatchObject({ color: COLORS.current, label: 'fib(2)' });
    expect(before.badge).toBeUndefined();
    expect(nodeLook('active', hitNode, hm!.hit!.step, hm, 'fib(2)', '1')).toMatchObject({
      color: COLORS.frontier, badge: 'cached = 1', badgeColor: COLORS.frontier,
    });
    expect(nodeLook('returned', hitNode, hitNode.exitStep!, hm, 'fib(2)', '1').color).toBe(COLORS.frontier);

    const root = s.tree.nodes.get(s.tree.roots[0])!;
    const rm = s.info.calls.get(root.callId);
    const storing = nodeLook('active', root, rm!.stored!.step, rm, 'fib(8)', '21');
    expect(storing).toMatchObject({ badge: '= 21', badgeColor: COLORS.changed, color: COLORS.current });
    expect(nodeLook('active', root, rm!.stored!.step - 1, rm, 'fib(8)', '21').badge).toBeUndefined();
    expect(nodeLook('returned', root, root.exitStep!, rm, 'fib(8)', '21')).toMatchObject({ badge: '= 21', badgeColor: COLORS.done });
    expect(nodeLook('future', root, 0, rm, 'fib(8)', '21').opacity).toBe(0);
  });

  it('sizes nodes for their widest badge', async () => {
    const s = await setup(exampleById('fibonacci-memo')!.code);
    const hitNode = hitNodes(s)[0];
    expect(finalBadge(hitNode, s.info.calls.get(hitNode.callId), '13')).toBe('cached = 13');
    expect(finalBadge(s.tree.nodes.get(s.tree.roots[0])!, undefined, '21')).toBe('= 21');
    expect(nodeWidth('fib(2)', 'cached = 13')).toBeGreaterThan(nodeWidth('fib(2)', '= 1'));
    expect(nodeWidth('', '')).toBe(1);
  });
});

describe('memo cache panel', () => {
  it('lists the entries in insertion order, the one stored at each step dropping in', async () => {
    const s = await setup(exampleById('fibonacci-memo')!.code);
    expect(buildCache(s.tl, 0, s.b, s.info, null)).toMatchObject({ name: 'memo', exists: false, cards: [], entries: 0, hits: 0 });
    expect(buildCache(s.tl, 2, s.b, s.info, null)).toMatchObject({ exists: true, cards: [], entries: 0 });

    const store4 = s.info.calls.get(nodes(s).find((n) => n.args[0] === 4 && n.children.length)!.callId)!.stored!.step;
    const m = buildCache(s.tl, store4, s.b, s.info, forward(s.tl, store4));
    expect(m.cards.map((c) => c.text)).toEqual(['2 → 1', '3 → 2', '4 → 3']);
    expect(m.written).toEqual({ id: m.cards[2].id, isNew: true });
    expect(m.cards[2]).toMatchObject({ color: COLORS.changed, pulse: true, entered: true });
    expect(m.cards.slice(0, 2).every((c) => c.color === ENTRY_COLOR && !c.pulse && !c.entered)).toBe(true);
    expect(m.read).toBeNull();
    // the next step: nothing new
    const next = buildCache(s.tl, store4 + 1, s.b, s.info, forward(s.tl, store4 + 1));
    expect(next.written).toBeNull();
    expect(next.cards.every((c) => !c.pulse && !c.entered)).toBe(true);

    const last = buildCache(s.tl, s.tl.steps.length - 1, s.b, s.info, null);
    expect(last.cards.map((c) => c.text)).toEqual(['2 → 1', '3 → 2', '4 → 3', '5 → 5', '6 → 8', '7 → 13', '8 → 21']);
    expect(last).toMatchObject({ entries: 7, hidden: 0, hits: 5 });
  });

  it('flashes the entry a cache hit reads and counts the hits', async () => {
    const s = await setup(exampleById('fibonacci-memo')!.code);
    const hit = s.info.calls.get(hitNodes(s)[1].callId)!.hit!;
    for (const step of hit.reads) {
      const m = buildCache(s.tl, step, s.b, s.info, forward(s.tl, step));
      expect(m.read).toBe(hit.key);
      expect(m.hits).toBe(2);
      const card = m.cards.find((c) => c.id === hit.key)!;
      expect(card).toMatchObject({ text: '3 → 2', color: COLORS.frontier, pulse: true, entered: false });
      expect(m.cards.filter((c) => c.pulse)).toHaveLength(1);
    }
    expect(buildCache(s.tl, hit.step - 1, s.b, s.info, null).hits).toBe(1);
    // stepping back onto the lookup: the entry is read but does not flash
    const back = buildCache(s.tl, hit.step, s.b, s.info, backward(s.tl, hit.step));
    expect(back.read).toBe(hit.key);
    expect(back.cards.every((c) => c.color === ENTRY_COLOR)).toBe(true);
  });

  it('stepping back over a store lifts its entry out; an undone update pulses in place', async () => {
    const fib = await setup(exampleById('fibonacci-memo')!.code);
    const store = fib.info.calls.get(fib.tree.roots[0])!.stored!.step;
    const undo = buildCache(fib.tl, store - 1, fib.b, fib.info, backward(fib.tl, store - 1));
    expect(undo.cards.map((c) => c.text)).not.toContain('8 → 21');
    expect(undo.leaving).toEqual({ slot: 6, text: '8 → 21' });
    expect(buildCache(fib.tl, store, fib.b, fib.info, forward(fib.tl, store)).leaving).toBeNull();

    const p = await setup(PLACEHOLDER);
    const top = p.info.calls.get(p.tree.roots[0])!.stored!.step;
    const m = buildCache(p.tl, top, p.b, p.info, forward(p.tl, top));
    expect(m.written).toEqual({ id: expect.any(String), isNew: false });
    const updated = m.cards.find((c) => c.id === m.written!.id)!;
    expect(updated).toMatchObject({ text: '5 → 8', color: COLORS.changed, pulse: true, entered: false });
    const reverted = buildCache(p.tl, top - 1, p.b, p.info, backward(p.tl, top - 1));
    expect(reverted.leaving).toBeNull();
    expect(reverted.cards.find((c) => c.id === m.written!.id)).toMatchObject({ text: '5 → 0', color: COLORS.changed, pulse: true });
  });

  it(`shows the newest ${CARD_CAP} entries, and an older one a hit reads in the first slot`, async () => {
    const s = await setup(MANY);
    const end = s.tree.nodes.get(s.tree.roots[0])!.exitStep!;
    const m = buildCache(s.tl, end, s.b, s.info, null);
    expect(m).toMatchObject({ entries: 19, hidden: 3 });
    expect(m.cards).toHaveLength(CARD_CAP);
    expect(m.cards[0].text).toBe('5 → 5');
    expect(m.cards.at(-1)!.text).toBe('20 → 6765');
    // the second top-level call fib(3) is answered from the cache
    const again = s.tree.nodes.get(s.tree.roots[1])!;
    const hit = s.info.calls.get(again.callId)!.hit!;
    const h = buildCache(s.tl, hit.step, s.b, s.info, forward(s.tl, hit.step));
    expect(h.cards).toHaveLength(CARD_CAP);
    expect(h.cards[0]).toMatchObject({ text: '3 → 2', color: COLORS.frontier });
    expect(h.cards[1].text).toBe('6 → 8');
  });

  it('arrays and tables list the slots written so far, keyed by index or row,col', async () => {
    const arr = await setup(`function climb(n) {
  const dp = new Array(n + 1).fill(-1);
  function go(i) {
    if (i <= 1) return 1;
    if (dp[i] !== -1) return dp[i];
    dp[i] = go(i - 1) + go(i - 2);
    return dp[i];
  }
  return go(n);
}
climb(5);`);
    expect(cards(arr, arr.tl.steps.length - 1)).toEqual(['2 → 2', '3 → 3', '4 → 5', '5 → 8']);
    const grid = await setup(`function paths(m, n) {
  const memo = Array.from({ length: m }, () => new Array(n).fill(0));
  function go(r, c) {
    if (r === 0 || c === 0) return 1;
    if (memo[r][c]) return memo[r][c];
    memo[r][c] = go(r - 1, c) + go(r, c - 1);
    return memo[r][c];
  }
  return go(m - 1, n - 1);
}
paths(3, 3);`);
    expect(cards(grid, grid.tl.steps.length - 1)).toEqual(['1,1 → 2', '1,2 → 3', '2,1 → 3', '2,2 → 6']);
    expect(hitNodes(grid).map((n) => labelOf(grid, n))).toEqual(['go(1, 1)']);
  });

  it('keeps one panel size through the run; card slots never overlap', async () => {
    for (const source of [exampleById('fibonacci-memo')!.code, MANY]) {
      const s = await setup(source);
      const extent = cacheExtent(s.tl, s.b, s.info);
      const geo = cacheLayout(extent, s.b.cache.name);
      let most = 0;
      for (let i = 0; i < s.tl.steps.length; i++) {
        const m = buildCache(s.tl, i, s.b, s.info, forward(s.tl, i));
        most = Math.max(most, m.entries);
        expect(m.cards.length).toBeLessThanOrEqual(geo.rows * geo.cols);
        for (const c of m.cards) expect(c.text.length).toBeLessThanOrEqual(extent.widest);
      }
      expect(extent.maxEntries).toBe(most);
      const slots = Array.from({ length: geo.rows * geo.cols }, (_, k) => slotCenter(geo, k));
      for (const [x, y] of slots) {
        expect(x - geo.cardW / 2).toBeGreaterThanOrEqual(0);
        expect(x + geo.cardW / 2).toBeLessThanOrEqual(geo.w + 1e-9);
        expect(y + 0.3).toBeLessThan(geo.titleY - 0.14);
      }
      for (let a = 0; a < slots.length; a++) {
        for (let k = a + 1; k < slots.length; k++) {
          const apart = Math.abs(slots[a][0] - slots[k][0]) >= geo.cardW || Math.abs(slots[a][1] - slots[k][1]) >= 0.6;
          expect(apart).toBe(true);
        }
      }
    }
  });
});
