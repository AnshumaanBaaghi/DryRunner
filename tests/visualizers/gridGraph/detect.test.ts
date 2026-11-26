/** Grid-graph detection: which 2D arrays a traversal walks, how cells are marked, the counter, claims and selection. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { tableShape } from '../../../src/visualizers/dp2d/detect';
import { gridGraphVisualizer } from '../../../src/visualizers/gridGraph';
import { detectGridGraph, GRID_GRAPH_SCORE, type GridGraphBindings } from '../../../src/visualizers/gridGraph/detect';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import {
  FLOOD_FILL_BFS, HEAD_INDEX_BFS, ISLANDS_BFS_SET, MAZE_ALL_PATHS, MAZE_VISITED, OBSTACLE_PATH, REGIONS_STACK, UNIQUE_PATHS_MEMO, WORD_SEARCH,
  XY_FILL,
} from './cases';

async function detect(source: string): Promise<{ tl: Timeline; ds: Detection<GridGraphBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, ds: detectGridGraph({ tl, analysis: analyzeTrace(tl) }) };
}

const example = (id: string) => exampleById(id)!.code;
const fnId = (tl: Timeline, name: string) => tl.meta.fns.find((f) => f.name === name)!.id;
const withGrid = () => [...visualizers().filter((v) => v.id !== 'gridGraph'), gridGraphVisualizer];
const shown = async (source: string) => selectDetections(detectAll(await timelineOf(source), withGrid()).all);
const names = (b: GridGraphBindings) => ({
  grid: b.grid.name, frontier: b.frontier?.name, row: b.rowVar?.name, col: b.colVar?.name, marks: b.marks.kind, visited: b.marks.ref?.name,
  counter: b.counter?.name, backtrack: b.backtrack,
});

describe('gridGraph detection', () => {
  it('islands: the grid sunk in place by the recursive sink(r, c), one island per count++', async () => {
    const { tl, ds } = await detect(example('islands'));
    expect(ds).toHaveLength(1);
    const [d] = ds;
    const b = d.bindings;
    expect(d).toMatchObject({ vizId: 'gridGraph', key: `gridGraph:obj:${b.objId}`, title: 'grid', score: GRID_GRAPH_SCORE, role: 'primary' });
    expect(names(b)).toEqual({ grid: 'grid', frontier: undefined, row: 'r', col: 'c', marks: 'inPlace', visited: undefined, counter: 'count' });
    expect([b.rows, b.cols, b.traversalFn, b.argIdx]).toEqual([4, 5, fnId(tl, 'sink'), [0, 1]]);
    // the grid, its rows, its variable and the recursion (the recursion tree gives way)
    const rows = tableShape(tl, b.objId).rowIds.map((id) => `obj:${id}`);
    expect(d.claims).toEqual([`obj:${b.objId}`, ...rows, varKey(b.grid), `fn:${fnId(tl, 'sink')}`]);
    expect(rows).toHaveLength(4);
  });

  it.each(['lcs', 'edit-distance', 'knapsack', 'n-queens', 'bfs', 'dfs', 'dijkstra', 'bubble-sort', 'nested-pairs'])(
    'finds no grid graph in %s',
    async (id) => {
      expect((await detect(example(id))).ds).toEqual([]);
    },
  );

  it('BFS flood fill: a queue of [r, c] pairs, cells recolored in place; the queue stays unclaimed', async () => {
    const { tl, ds } = await detect(FLOOD_FILL_BFS);
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(d.title).toBe('image');
    expect(names(d.bindings)).toEqual({ grid: 'image', frontier: 'queue', row: 'r', col: 'c', marks: 'inPlace', visited: undefined, counter: undefined });
    expect([d.bindings.rows, d.bindings.cols, d.bindings.traversalFn, d.bindings.argIdx]).toEqual([3, 3, undefined, [0, 1]]);
    const queue = analyzeTrace(tl).vars.get(varKey(d.bindings.frontier!))!;
    expect(d.claims).not.toContain(varKey(d.bindings.frontier!));
    for (const id of queue.heapIds) expect(d.claims).not.toContain(`obj:${id}`);
    expect(d.claims.filter((c) => c.startsWith('fn:'))).toEqual([]);
  });

  it('maze: walls in the grid, a separate visited 2D array claimed along with it', async () => {
    const { tl, ds } = await detect(MAZE_VISITED);
    expect(ds).toHaveLength(1);
    const [d] = ds;
    const b = d.bindings;
    expect(d.title).toBe('maze');
    expect(names(b)).toEqual({ grid: 'maze', frontier: undefined, row: 'r', col: 'c', marks: 'array', visited: 'visited', counter: undefined });
    expect(b.traversalFn).toBe(fnId(tl, 'dfs'));
    const visitedRows = tableShape(tl, b.marks.objId!).rowIds.map((id) => `obj:${id}`);
    expect(d.claims).toEqual(expect.arrayContaining([`obj:${b.marks.objId}`, ...visitedRows, varKey(b.marks.ref!), varKey(b.grid), `fn:${b.traversalFn}`]));
  });

  it('BFS islands: a fresh queue per island, a visited Set of "r,c" keys, the counter', async () => {
    const { ds } = await detect(ISLANDS_BFS_SET);
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(names(d.bindings)).toEqual({ grid: 'grid', frontier: 'queue', row: 'cr', col: 'cc', marks: 'set', visited: 'seen', counter: 'islands' });
    expect(d.claims).toContain(`obj:${d.bindings.marks.objId}`);
  });

  it('iterative DFS: a stack of pairs drained by pop', async () => {
    const { ds } = await detect(REGIONS_STACK);
    expect(ds.map((d) => names(d.bindings))).toEqual([
      { grid: 'grid', frontier: 'stack', row: 'cr', col: 'cc', marks: 'array', visited: 'seen', counter: 'regions' },
    ]);
  });

  it('head-index queue: drained by reading queue[head++], a distance table as the visited array', async () => {
    const { ds } = await detect(HEAD_INDEX_BFS);
    expect(ds.map((d) => names(d.bindings))).toEqual([
      { grid: 'grid', frontier: 'queue', row: 'r', col: 'c', marks: 'array', visited: 'dist', counter: undefined },
    ]);
  });

  it('[x, y] pairs on a map indexed map[y][x]: the row is the pair\'s second element', async () => {
    const { ds } = await detect(XY_FILL);
    const [d] = ds;
    expect(d.bindings.argIdx).toEqual([1, 0]);
    expect(names(d.bindings)).toMatchObject({ grid: 'map', frontier: 'todo', row: 'y', col: 'x', marks: 'inPlace' });
  });

  it('a path search unmarking cells once its calls returned: backtracking, the recursion left to its tree', async () => {
    const { tl, ds } = await detect(MAZE_ALL_PATHS);
    expect(ds).toHaveLength(1);
    const [d] = ds;
    expect(names(d.bindings)).toEqual({ grid: 'maze', frontier: undefined, row: 'r', col: 'c', marks: 'array', visited: 'seen', counter: undefined, backtrack: true });
    expect(d.bindings.traversalFn).toBe(fnId(tl, 'walk'));
    expect(d.claims.filter((c) => c.startsWith('fn:'))).toEqual([]);
  });

  it('obstacle eliminations: the grid of values walked, not the memo table of objects shaped like it; marks in place, put back', async () => {
    const { tl, ds } = await detect(OBSTACLE_PATH);
    expect(ds).toHaveLength(1);
    const [d] = ds;
    const b = d.bindings;
    expect(names(b)).toEqual({ grid: 'grid', frontier: undefined, row: 'row', col: 'col', marks: 'inPlace', visited: undefined, counter: undefined, backtrack: true });
    expect([b.rows, b.cols, b.traversalFn, b.argIdx]).toEqual([5, 4, fnId(tl, 'shortestPossiblePath'), [4, 5]]);
    const dp = analyzeTrace(tl).vars.get(varKey({ name: 'dp', fnId: fnId(tl, 'shortestPath') }))!;
    for (const id of dp.heapIds) expect(d.claims).not.toContain(`obj:${id}`);
    expect(d.claims.filter((c) => c.startsWith('fn:'))).toEqual([]);
  });

  it('word search: cells restored after the recursive calls read as backtracking too', async () => {
    const { ds } = await detect(WORD_SEARCH);
    expect(ds.map((d) => names(d.bindings))).toEqual([
      { grid: 'board', frontier: undefined, row: 'r', col: 'c', marks: 'inPlace', visited: undefined, counter: undefined, backtrack: true },
    ]);
  });

  it('leaves a memo table stored after recursing alone', async () => {
    expect((await detect(UNIQUE_PATHS_MEMO)).ds).toEqual([]);
  });
});

describe('gridGraph selection', () => {
  it('islands: the grid is the primary view, the call stack stays, no recursion tree, no DP table', async () => {
    const chosen = await shown(example('islands'));
    expect(chosen[0]).toMatchObject({ vizId: 'gridGraph', role: 'primary', title: 'grid' });
    expect(chosen.some((d) => d.vizId === 'callStack')).toBe(true);
    expect(chosen.some((d) => d.vizId === 'recursionTree' || d.vizId === 'dp2d')).toBe(false);
  });

  it('BFS flood fill: the grid beside the queue it is drained from', async () => {
    const chosen = await shown(FLOOD_FILL_BFS);
    expect(chosen.map((d) => `${d.vizId}:${d.role}`)).toEqual(['gridGraph:primary', 'queue:secondary']);
  });

  it('maze: the grid replaces the recursion tree; the visited array gets no view of its own', async () => {
    const chosen = await shown(MAZE_VISITED);
    expect(chosen[0]).toMatchObject({ vizId: 'gridGraph', title: 'maze' });
    expect(chosen.map((d) => d.vizId)).not.toContain('recursionTree');
    expect(chosen.some((d) => d.vizId === 'array' && d.title === 'visited')).toBe(false);
  });

  it.each([
    ['shortest path with obstacle eliminations', OBSTACLE_PATH, 'grid', 'shortestPossiblePath'],
    ['every path through a maze', MAZE_ALL_PATHS, 'maze', 'walk'],
  ])('backtracking path search (%s): the grid first, its recursion tree beside it, the call stack', async (_, source, grid, fn) => {
    const chosen = await shown(source);
    expect(chosen.map((d) => `${d.vizId}:${d.title}:${d.role}`)).toEqual([
      `gridGraph:${grid}:primary`, `recursionTree:${fn}:secondary`, 'callStack:call stack:aux',
    ]);
  });

  it('look-alikes keep their own views', async () => {
    expect((await shown(WORD_SEARCH))[0].vizId).toBe('backtracking');
    expect((await shown(UNIQUE_PATHS_MEMO))[0].vizId).toBe('memo');
  });
});
