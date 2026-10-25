/** Hash-map model: cards in insertion order and what each does per step (forward and stepping back), misses, the cap, a stable panel. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { HeapChange, Timeline } from '../../../src/engine/timeline/types';
import type { ReadEvent } from '../../../src/engine/types/trace';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { detectHashMaps, type HashMapBindings } from '../../../src/visualizers/hashMap/detect';
import { missText } from '../../../src/visualizers/hashMap/entries';
import { buildHashModel, CARD_CAP, ENTRY_COLOR, hashExtent, type HashModel } from '../../../src/visualizers/hashMap/model';
import { CARD, chipCenter, chipWidth, hashLayout, slotCenter, STATS_SIZE, textWidth, titleText } from '../../../src/visualizers/hashMap/panel';
import { timelineOf } from '../../helpers/timeline';

interface Setup {
  tl: Timeline;
  b: HashMapBindings;
}

async function setup(source: string, k = 0): Promise<Setup> {
  const tl = await timelineOf(source);
  return { tl, b: detectHashMaps({ tl, analysis: analyzeTrace(tl) })[k].bindings };
}

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** stepping back from i + 1 to i: the undone step's changes */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });
const at = (s: Setup, i: number, hl: Highlight | null = forward(s.tl, i)) => buildHashModel(s.tl, i, s.b, hl);
const texts = (m: HashModel) => m.cards.map((c) => c.text);
const stepWhere = (tl: Timeline, change: (h: HeapChange) => boolean) => tl.diffs.findIndex((d) => d.heap.some(change));
const readStep = (tl: Timeline, read: (r: ReadEvent) => boolean) => tl.diffs.findIndex((d) => d.reads.some(read));
const last = (s: Setup) => s.tl.steps.length - 1;

const MAP_OPS = `const m = new Map();
m.set('a', 1);
m.set('b', 2);
m.set('c', 3);
m.delete('b');
m.clear();`;

const MANY = `const s = new Set();
for (let i = 0; i < 30; i++) s.add(i);
s.has(2);
s.has(99);`;

const PER_ROW = `function distinctRows(board) {
  for (const row of board) {
    const seen = new Set();
    for (const v of row) {
      if (seen.has(v)) return false;
      seen.add(v);
    }
  }
  return true;
}
distinctRows([[1, 2], [3, 4, 5]]);`;

describe('hash map cards', () => {
  it('longest-substring: entries in insertion order, each added one dropping in', async () => {
    const s = await setup(exampleById('longest-substring')!.code);
    expect(at(s, 0)).toMatchObject({ kind: 'map', exists: false, size: 0, cards: [], hidden: 0, leaving: [], misses: [], focus: null });
    const created = stepWhere(s.tl, (h) => h.op === 'alloc' && h.id === s.b.objId);
    expect(at(s, created)).toMatchObject({ exists: true, size: 0, cards: [] });
    const add = stepWhere(s.tl, (h) => h.op === 'mapSet');
    const m = at(s, add);
    expect(m.cards).toEqual([{ id: 's:a', text: 'a → 0', state: 'added', color: COLORS.changed, pulse: true, entered: true }]);
    expect(m).toMatchObject({ size: 1, focus: 0 });
    // the next step: nothing new
    expect(at(s, add + 1).cards).toMatchObject([{ state: 'idle', color: ENTRY_COLOR, pulse: false, entered: false }]);
    expect(at(s, add + 1).focus).toBeNull();
    expect(texts(at(s, last(s)))).toEqual(['a → 3', 'b → 7', 'c → 5']);
    expect(at(s, last(s), null).size).toBe(3);
  });

  it('an update pulses with old → new; stepping back over it shows new → old', async () => {
    const s = await setup(exampleById('longest-substring')!.code);
    const update = stepWhere(s.tl, (h) => h.op === 'mapSet' && h.old !== undefined);
    const m = at(s, update);
    expect(m.cards[0]).toMatchObject({ text: 'a → 3', state: 'updated', color: COLORS.changed, pulse: true, entered: false, delta: '0 → 3' });
    expect(m.cards.slice(1).every((c) => c.state === 'idle')).toBe(true);
    expect(m.focus).toBe(0);
    const back = at(s, update - 1, backward(s.tl, update - 1));
    expect(back.cards[0]).toMatchObject({ text: 'a → 0', state: 'updated', pulse: true, delta: '3 → 0' });
    expect(back.leaving).toEqual([]);
  });

  it('stepping back over an addition lifts the entry out of its slot', async () => {
    const s = await setup(exampleById('longest-substring')!.code);
    const add = s.tl.diffs.findIndex((d, i) => i > 0 && d.heap.some((h) => h.op === 'mapSet' && h.key === 'c'));
    const back = at(s, add - 1, backward(s.tl, add - 1));
    expect(texts(back)).toEqual(['a → 0', 'b → 1']);
    expect(back.leaving).toEqual([{ id: 's:c', slot: 2, text: 'c → 2', color: COLORS.changed }]);
    expect(back.focus).toBe(2);
    expect(at(s, add).leaving).toEqual([]);
  });

  it('a lookup flashes the card it finds amber; a miss names the key; stepping back flashes nothing', async () => {
    const s = await setup(exampleById('longest-substring')!.code);
    const hit = readStep(s.tl, (r) => r.op === 'has' && r.value === true);
    const m = at(s, hit);
    expect(m.cards[0]).toMatchObject({ text: 'a → 0', state: 'hit', color: COLORS.current, pulse: true, entered: false });
    expect(m.cards.filter((c) => c.pulse)).toHaveLength(1);
    expect(m).toMatchObject({ misses: [], focus: 0 });
    const back = at(s, hit, backward(s.tl, hit));
    expect(back.cards.every((c) => c.state === 'idle')).toBe(true);
    expect(back.misses).toEqual([]);

    const miss = readStep(s.tl, (r) => r.op === 'has' && r.value === false);
    expect(at(s, miss)).toMatchObject({ cards: [], misses: ['a'], focus: null });
    expect(at(s, miss, null).misses).toEqual([]);
  });

  it('a removal lifts the card out of its slot in red; stepping back drops it in again', async () => {
    const s = await setup(MAP_OPS);
    const del = stepWhere(s.tl, (h) => h.op === 'mapDelete');
    const m = at(s, del);
    expect(texts(m)).toEqual(['a → 1', 'c → 3']);
    expect(m.leaving).toEqual([{ id: 's:b', slot: 1, text: 'b → 2', color: COLORS.error }]);
    expect(m.focus).toBe(1);
    const undo = at(s, del - 1, backward(s.tl, del - 1));
    expect(texts(undo)).toEqual(['a → 1', 'b → 2', 'c → 3']);
    expect(undo.cards[1]).toMatchObject({ state: 'added', entered: true, pulse: true });
    expect(undo.leaving).toEqual([]);
  });

  it('clear() lifts every card out; stepping back drops them all in', async () => {
    const s = await setup(MAP_OPS);
    const clear = stepWhere(s.tl, (h) => h.op === 'mapClear');
    const m = at(s, clear);
    expect(m).toMatchObject({ exists: true, size: 0, cards: [], focus: 0 });
    expect(m.leaving.map((l) => `${l.slot}:${l.text}`)).toEqual(['0:a → 1', '1:c → 3']);
    const undo = at(s, clear - 1, backward(s.tl, clear - 1));
    expect(undo.cards.map((c) => `${c.text}:${c.entered}`)).toEqual(['a → 1:true', 'c → 3:true']);
  });

  it('a Set: one chip per value; values it was created with drop in', async () => {
    const s = await setup(exampleById('bfs')!.code);
    const created = stepWhere(s.tl, (h) => h.op === 'alloc' && h.id === s.b.objId);
    expect(at(s, created).cards).toMatchObject([{ text: '0', state: 'added', entered: true }]);
    const add = stepWhere(s.tl, (h) => h.op === 'setAdd');
    expect(at(s, add).cards.map((c) => `${c.text}:${c.state}`)).toEqual(['0:idle', '1:added']);
    expect(texts(at(s, last(s)))).toEqual(['0', '1', '2', '3', '4', '5']);
    const back = at(s, created - 1, backward(s.tl, created - 1));
    expect(back).toMatchObject({ exists: false, cards: [], leaving: [{ slot: 0, text: '0' }] });
  });

  it('a plain object: "key: value" cards in property order; a read-and-write is an update', async () => {
    const s = await setup(`const count = {};
for (const ch of 'abca') count[ch] = (count[ch] || 0) + 1;
const seen = {};
seen[5] = true;
seen[1] = true;
seen.x = true;`);
    expect(texts(at(s, last(s)))).toEqual(['a: 2', 'b: 1', 'c: 1']);
    const again = s.tl.diffs.findIndex((d) => d.heap.some((h) => h.op === 'set' && h.old !== undefined));
    expect(s.tl.diffs[again].reads).toEqual([expect.objectContaining({ path: ['a'], value: 1 })]);
    expect(at(s, again).cards[0]).toMatchObject({ text: 'a: 2', state: 'updated', delta: '1 → 2' });
    const numeric = await setup(`const seen = {};
seen[5] = true;
seen[1] = true;
seen.x = true;`);
    expect(texts(at(numeric, last(numeric)))).toEqual(['1: true', '5: true', 'x: true']);
  });

  it(`shows the newest ${CARD_CAP} entries; an older one a lookup finds takes the first slot`, async () => {
    const s = await setup(MANY);
    const end = at(s, last(s), null);
    expect(end).toMatchObject({ size: 30, hidden: 6 });
    expect(end.cards).toHaveLength(CARD_CAP);
    expect([end.cards[0].text, end.cards[CARD_CAP - 1].text]).toEqual(['6', '29']);
    const old = readStep(s.tl, (r) => r.op === 'has' && r.value === true);
    const m = at(s, old);
    expect(m.cards).toHaveLength(CARD_CAP);
    expect(texts(m).slice(0, 2)).toEqual(['2', '7']);
    expect(m).toMatchObject({ hidden: 6, focus: 0 });
    expect(m.cards[0].state).toBe('hit');
    const miss = readStep(s.tl, (r) => r.op === 'has' && r.value === false);
    expect(at(s, miss)).toMatchObject({ misses: ['99'], focus: null });
  });

  it('follows its variable to the Set made in each loop iteration', async () => {
    const s = await setup(PER_ROW);
    const firstRow = s.tl.diffs.findIndex((d) => d.heap.some((h) => h.op === 'setAdd' && h.key === 2));
    expect(texts(at(s, firstRow))).toEqual(['1', '2']);
    const secondRow = s.tl.diffs.findIndex((d) => d.heap.some((h) => h.op === 'setAdd' && h.key === 3));
    expect(at(s, secondRow).cards.map((c) => `${c.text}:${c.state}`)).toEqual(['3:added']);
    expect(texts(at(s, last(s)))).toEqual(['3', '4', '5']);
    expect(hashExtent(s.tl, s.b).maxEntries).toBe(3);
  });

  it('keeps key text to the label glyphs', async () => {
    const s = await setup(`const m = new Map();
m.set('é', 1);
m.set('a very long key indeed', 'and a long value');`);
    expect(texts(at(s, last(s)))).toEqual(['? → 1', "a very lo… → 'and a lo…"]);
  });
});

describe('hash map panel', () => {
  it('keeps one size through the run; card slots never overlap and stay inside it', async () => {
    const sources = [exampleById('longest-substring')!.code, exampleById('bfs')!.code, MAP_OPS, MANY, PER_ROW];
    for (const source of sources) {
      const s = await setup(source);
      const extent = hashExtent(s.tl, s.b);
      const g = hashLayout(extent, s.b.kind, titleText('name', s.b.kind));
      expect(g.cols).toBeGreaterThanOrEqual(2);
      expect(g.cols).toBeLessThanOrEqual(4);
      let most = 0;
      for (let i = 0; i < s.tl.steps.length; i++) {
        for (const hl of [forward(s.tl, i), i < last(s) ? backward(s.tl, i) : null]) {
          const m = at(s, i, hl);
          most = Math.max(most, m.size);
          expect(m.cards.length).toBeLessThanOrEqual(g.rows * g.cols);
          for (const c of m.cards) expect([...c.text].length).toBeLessThanOrEqual(extent.widest);
          for (const l of m.leaving) expect(l.slot).toBeLessThan(g.rows * g.cols);
          if (!m.misses.length) continue;
          // the miss chip fits on the size line, right of the size
          const chip = missText(m.misses);
          const [x] = chipCenter(g, chip);
          expect(x - chipWidth(chip) / 2).toBeGreaterThan(g.x0 + textWidth(`size ${extent.maxEntries}`, STATS_SIZE));
          expect(x + chipWidth(chip) / 2).toBeLessThanOrEqual(g.x0 + g.w + 1e-9);
        }
      }
      expect(extent.maxEntries).toBe(most);
      const slots = Array.from({ length: g.rows * g.cols }, (_, k) => slotCenter(g, k));
      for (const [x, y] of slots) {
        expect(x - g.cardW / 2).toBeGreaterThanOrEqual(g.x0 - 1e-9);
        expect(x + g.cardW / 2).toBeLessThanOrEqual(g.x0 + g.w + 1e-9);
        expect(y - CARD.h / 2).toBeGreaterThan(0.4);
        expect(y + CARD.h / 2).toBeLessThan(g.titleY - 0.14);
      }
      for (let a = 0; a < slots.length; a++) {
        for (let k = a + 1; k < slots.length; k++) {
          const apart = Math.abs(slots[a][0] - slots[k][0]) >= g.cardW || Math.abs(slots[a][1] - slots[k][1]) >= CARD.h;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('fills the grid row by row in 2–4 columns', () => {
    const cols = (maxEntries: number) => hashLayout({ maxEntries, widest: 1, widestMiss: 0 }, 'set', 's · Set').cols;
    expect([1, 3, 6, 9, 16, 24, 100].map(cols)).toEqual([2, 2, 3, 3, 4, 4, 4]);
    const g = hashLayout({ maxEntries: 6, widest: 1, widestMiss: 0 }, 'set', 's · Set');
    const [x0, y0] = slotCenter(g, 0);
    const [x1, y1] = slotCenter(g, 1);
    const [x3, y3] = slotCenter(g, 3);
    expect(y1).toBe(y0);
    expect(x1).toBeGreaterThan(x0);
    expect(x3).toBe(x0);
    expect(y3).toBeLessThan(y0);
    // wide cards: fewer columns
    expect(hashLayout({ maxEntries: 24, widest: 23, widestMiss: 0 }, 'map', 'm · Map').cols).toBe(2);
    // room for a miss chip only when the run misses
    expect(hashLayout({ maxEntries: 6, widest: 1, widestMiss: 15 }, 'set', 's').w).toBeGreaterThan(g.w);
  });

  it('measures the widest miss chip of the run', async () => {
    const lastSeen = await setup(exampleById('longest-substring')!.code);
    expect(hashExtent(lastSeen.tl, lastSeen.b)).toEqual({ maxEntries: 3, widest: 5, widestMiss: 'miss a'.length });
    const s = await setup(`const count = {};
for (const ch of 'abca') count[ch] = (count[ch] || 0) + 1;`);
    expect(hashExtent(s.tl, s.b).widestMiss).toBe(0);
  });
});
