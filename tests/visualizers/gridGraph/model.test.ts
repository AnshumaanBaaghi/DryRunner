/** Grid-graph model per step: cell kinds and colors, visited components, the current cell, probes, the DFS path / BFS frontier, the counter. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { COLORS } from '../../../src/scene/primitives/materials';
import { EMPTY, rowsAt } from '../../../src/visualizers/dp1d/table';
import { detectGridGraph, type GridGraphBindings } from '../../../src/visualizers/gridGraph/detect';
import { buildGridModel, LAND, OTHER, tintOf, WALL, WATER, type GridModel } from '../../../src/visualizers/gridGraph/model';
import { timelineOf } from '../../helpers/timeline';
import { FLOOD_FILL_BFS, HEAD_INDEX_BFS, MAZE_VISITED, ROTTING_ORANGES, TWO_GRIDS } from './cases';

async function setup(source: string): Promise<{ tl: Timeline; b: GridGraphBindings }> {
  const tl = await timelineOf(source);
  const [d] = detectGridGraph({ tl, analysis: analyzeTrace(tl) });
  return { tl, b: d.bindings };
}

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** stepping back from i + 1 to i: the undone step's changes */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });
const at = (tl: Timeline, b: GridGraphBindings, i: number) => buildGridModel(tl, i, b, forward(tl, i));
const k = (m: GridModel, r: number, c: number) => r * m.cols + c;
const cells = (list: { r: number; c: number }[]) => list.map((x) => `${x.r},${x.c}`);

/** Step entering the first call of `name` made with (r, c). */
function callAt(tl: Timeline, name: string, r: number, c: number): number {
  const fn = tl.meta.fns.find((f) => f.name === name)!.id;
  return [...tl.calls.values()].find((n) => n.fnId === fn && n.args[0] === r && n.args[1] === c)!.enterStep;
}

/** First step writing cell (r, c) of a 2D array (the grid by default). */
function writeAt(tl: Timeline, b: GridGraphBindings, r: number, c: number, outer = b.objId): number {
  return tl.diffs.findIndex((d, s) => d.heap.some((h) => h.op === 'set' && rowsAt(tl, outer, s).get(h.id) === r && h.path[0] === c));
}

describe('gridGraph model: islands (DFS sinking in place)', () => {
  it('sinking (0,0): the current cell amber, marked this step, the first island begun', async () => {
    const { tl, b } = await setup(exampleById('islands')!.code);
    const w = writeAt(tl, b, 0, 0);
    const m = at(tl, b, w);
    expect([m.rows, m.cols, m.exists]).toEqual([4, 5, true]);
    expect(m.current).toMatchObject({ r: 0, c: 0, inside: true });
    expect(cells(m.marked)).toEqual(['0,0']);
    expect([m.component[k(m, 0, 0)], m.color[k(m, 0, 0)], m.ink[k(m, 0, 0)]]).toEqual([0, COLORS.current, COLORS.bg]);
    // kinds follow the values: the sunk cell now reads '0'
    expect([m.text[k(m, 0, 0)], m.kind[k(m, 0, 0)]]).toEqual(['0', 'water']);
    expect([m.text[k(m, 0, 1)], m.kind[k(m, 0, 1)], m.color[k(m, 0, 1)], m.component[k(m, 0, 1)]]).toEqual(['1', 'land', LAND, -1]);
    expect([m.kind[k(m, 0, 2)], m.color[k(m, 0, 2)]]).toEqual(['water', WATER]);
    expect([m.waiting, m.probes, m.focus]).toEqual([[], [], { r: 0, c: 0 }]);
    expect([m.components, m.counter]).toEqual([1, { name: 'count', text: '1' }]);
  });

  it('deeper in the DFS: the calls below the current one are its path, its own cell probed next', async () => {
    const { tl, b } = await setup(exampleById('islands')!.code);
    const s = callAt(tl, 'sink', 1, 1);
    const m = at(tl, b, s);
    expect(m.current).toMatchObject({ r: 1, c: 1, inside: true, key: `call:${tl.steps[s].callId}` });
    expect(cells(m.waiting)).toEqual(['0,0', '1,0']);
    const next = at(tl, b, s + 1);
    expect(next.probes).toEqual([{ r: 1, c: 1, inside: true }]);
    // the visited cells keep their island's tint and stand raised above the unvisited land
    expect([next.color[k(next, 1, 0)], next.component[k(next, 1, 0)]]).toEqual([tintOf(0), 0]);
    expect(next.raise[k(next, 1, 0)]).toBeGreaterThan(next.raise[k(next, 2, 2)]);
  });

  it('a call stepping off the grid: probed as nothing, no cell lit, the focus holds', async () => {
    const { tl, b } = await setup(exampleById('islands')!.code);
    const s = callAt(tl, 'sink', -1, 1);
    const m = at(tl, b, s);
    expect(m.probes).toEqual([{ r: -1, c: 1, inside: false }]);
    expect(m.current).toMatchObject({ r: -1, c: 1, inside: false });
    expect(m.color).not.toContain(COLORS.current);
    expect(m.focus).toEqual(at(tl, b, s - 1).focus);
    expect(m.focus).toEqual({ r: 0, c: 1 });
  });

  it('the finished map: three islands tinted apart, water deep blue, the counter at 3', async () => {
    const { tl, b } = await setup(exampleById('islands')!.code);
    const m = at(tl, b, tl.steps.length - 1);
    expect([m.components, m.counter?.text, m.current, m.waiting]).toEqual([3, '3', null, []]);
    const comps = m.component.flatMap((comp, x) => (comp >= 0 ? [`${Math.floor(x / m.cols)},${x % m.cols}:${comp}`] : []));
    expect(comps).toEqual(['0,0:0', '0,1:0', '1,0:0', '1,1:0', '2,2:1', '3,3:2', '3,4:2']);
    expect([m.color[k(m, 2, 2)], m.color[k(m, 3, 4)], m.color[k(m, 0, 4)]]).toEqual([tintOf(1), tintOf(2), WATER]);
    expect(m.text.every((t) => t === '0')).toBe(true);
  });

  it('stepping back over a sink: the cell unvisited again, flagged as the undone mark', async () => {
    const { tl, b } = await setup(exampleById('islands')!.code);
    const w = writeAt(tl, b, 1, 0);
    const m = buildGridModel(tl, w - 1, b, backward(tl, w - 1));
    expect(cells(m.marked)).toEqual(['1,0']);
    expect([m.component[k(m, 1, 0)], m.kind[k(m, 1, 0)], m.text[k(m, 1, 0)]]).toEqual([-1, 'land', '1']);
    // without a highlight nothing is flagged
    const plain = buildGridModel(tl, w, b, null);
    expect([plain.marked, plain.probes]).toEqual([[], []]);
  });

  it('keeps one board size through the trace, empty before the grid exists, the counter blank until declared', async () => {
    const { tl, b } = await setup(exampleById('islands')!.code);
    const sizes = new Set<string>();
    for (let i = 0; i < tl.steps.length; i += 7) sizes.add(`${at(tl, b, i).rows}x${at(tl, b, i).cols}:${at(tl, b, i).text.length}`);
    expect([...sizes]).toEqual(['4x5:20']);
    const before = at(tl, b, 0);
    expect([before.exists, before.color.every((c) => c === EMPTY), before.text.every((t) => t === '')]).toEqual([false, true, true]);
    expect(at(tl, b, 2).counter).toEqual({ name: 'count', text: '·' });
  });
});

describe('gridGraph model: BFS and mazes', () => {
  it('BFS flood fill: the cell taken out is current while the loop runs, queued cells wait, cells fill as queued', async () => {
    const { tl, b } = await setup(FLOOD_FILL_BFS);
    const shifts = tl.diffs.flatMap((d, s) => (d.heap.some((h) => h.op === 'shift') ? [s] : []));
    const first = at(tl, b, shifts[0]);
    expect(first.current).toMatchObject({ r: 1, c: 1, inside: true, key: `pop:${shifts[0]}` });
    expect(first.component[k(first, 1, 1)]).toBe(0);
    const w = writeAt(tl, b, 0, 1);
    const filled = at(tl, b, w);
    expect([cells(filled.marked), filled.current?.r, filled.current?.c]).toEqual([['0,1'], 1, 1]);
    expect(cells(at(tl, b, w + 1).waiting)).toEqual(['0,1']);
    expect(cells(at(tl, b, shifts[1]).waiting)).toEqual(['1,0']);
    const end = at(tl, b, tl.steps.length - 1);
    expect([end.current, end.waiting]).toEqual([null, []]);
    // the corner the fill never reaches is still unvisited land; the zeros are water
    expect([end.kind[k(end, 2, 2)], end.color[k(end, 2, 2)], end.kind[k(end, 1, 2)], end.color[k(end, 1, 2)]]).toEqual(['land', LAND, 'water', WATER]);
    expect(end.component.filter((x) => x === 0)).toHaveLength(6);
  });

  it('maze: walls dark, open cells the walkable ground, the visited array tinting the path taken', async () => {
    const { tl, b } = await setup(MAZE_VISITED);
    const m = at(tl, b, tl.steps.length - 1);
    expect([m.kind[k(m, 0, 2)], m.color[k(m, 0, 2)], m.kind[k(m, 0, 0)], m.text[k(m, 0, 2)]]).toEqual(['wall', WALL, 'land', '#']);
    expect(m.raise[k(m, 0, 2)]).toBeGreaterThan(m.raise[k(m, 3, 0)]);
    const visited = m.component.flatMap((comp, x) => (comp >= 0 ? [`${Math.floor(x / m.cols)},${x % m.cols}`] : []));
    expect(visited).toEqual(['0,0', '0,1', '1,1', '2,1', '2,2', '2,3']);
    // the goal is reached, not marked
    expect([m.component[k(m, 3, 3)], m.kind[k(m, 3, 3)]]).toEqual([-1, 'land']);
  });

  it('maze: reading a cell of the maze and of the visited array is one probe', async () => {
    const { tl, b } = await setup(MAZE_VISITED);
    const s = callAt(tl, 'dfs', 0, 0);
    const probing = [s, s + 1, s + 2].map((i) => at(tl, b, i).probes).find((p) => p.length);
    expect(probing).toEqual([{ r: 0, c: 0, inside: true }]);
  });

  it('level-by-level BFS: one run (one tint) across the levels, the current cell kept between them', async () => {
    const { tl, b } = await setup(ROTTING_ORANGES);
    const end = at(tl, b, tl.steps.length - 1);
    expect(end.component.filter((x) => x === 0)).toHaveLength(6);
    expect(end.component.some((x) => x > 0)).toBe(false);
    // the orange rotten from the start is a source, not ground the BFS walks
    expect([end.kind[k(end, 0, 0)], end.color[k(end, 0, 0)], end.component[k(end, 0, 0)]]).toEqual(['other', OTHER, -1]);
    const minutes = tl.meta.bindings.filter((x) => x.name === 'minutes').map((x) => x.id);
    const between = tl.diffs.findIndex((d) => d.vars.some((v) => minutes.includes(v.bid) && v.kind === 'changed'));
    expect(at(tl, b, between).current).toMatchObject({ inside: true });
  });

  it('head-index queue: cells already read stay out of the waiting frontier', async () => {
    const { tl, b } = await setup(HEAD_INDEX_BFS);
    const w = writeAt(tl, b, 0, 1, b.marks.objId);
    expect(cells(at(tl, b, w + 1).waiting)).toEqual(['0,1']);
    const end = at(tl, b, tl.steps.length - 1);
    expect([end.waiting, end.current]).toEqual([[], null]);
    expect(end.component.filter((x) => x === 0)).toHaveLength(7);
  });

  it('a second run on another grid leaves the first board as its own run finished', async () => {
    const { tl, b } = await setup(TWO_GRIDS);
    const sink = tl.meta.fns.find((f) => f.name === 'sink')!.id;
    const second = [...tl.calls.values()].filter((n) => n.fnId === sink).find((n) => n.enterStep > tl.calls.get(1)!.exitStep!)!;
    const during = at(tl, b, second.enterStep + 1);
    expect([during.current, during.waiting, during.probes]).toEqual([null, [], []]);
    const end = at(tl, b, tl.steps.length - 1);
    expect([end.components, end.counter?.text]).toEqual([3, '3']);
  });
});
