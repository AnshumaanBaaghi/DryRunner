/** Graph detection: representations, traversal roles, claims, what the stage shows with every plugin, and what is not a graph. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { varKey, type VarRef } from '../../../src/engine/detect/track';
import type { Timeline } from '../../../src/engine/timeline/types';
import { graphVisualizer } from '../../../src/visualizers/graph';
import type { GraphBindings } from '../../../src/visualizers/graph/detect';
import { visualizers } from '../../../src/visualizers/registry';
import { detectAll, selectDetections } from '../../../src/visualizers/select';
import type { Detection } from '../../../src/visualizers/types';
import { timelineOf } from '../../helpers/timeline';
import {
  BELLMAN, BELLMAN_FIELDS, BFS_DIST, CLASS_GRAPH, DIJKSTRA_BODY, example, FOREACH_DFS, GRID_BFS, HEAD_BFS, INDEX_BFS, KAHN, MAP_BFS, MATRIX_BFS,
  MATRIX_DFS, NOT_GRAPH, PAIRS_LOOP, STACK_DFS,
} from './cases';

async function graphs(source: string): Promise<{ tl: Timeline; found: Detection<GraphBindings>[] }> {
  const tl = await timelineOf(source);
  return { tl, found: graphVisualizer.detect({ tl, analysis: analyzeTrace(tl) }) };
}

async function one(source: string): Promise<{ tl: Timeline; d: Detection<GraphBindings> }> {
  const { tl, found } = await graphs(source);
  expect(found).toHaveLength(1);
  return { tl, d: found[0] };
}

/** What the stage shows with every registered plugin plus this one (last, or first: ahead of array and dp1d, which also score 0.9). */
async function stage(source: string, first = false): Promise<Detection[]> {
  const tl = await timelineOf(source);
  const others = visualizers().filter((p) => p.id !== 'graph');
  return selectDetections(detectAll(tl, first ? [graphVisualizer, ...others] : [...others, graphVisualizer]).all);
}

const name = (ref: VarRef | undefined) => ref?.name;
const roles = (b: GraphBindings) => ({
  current: name(b.current), neighbor: name(b.neighbor), visited: name(b.visited), frontier: name(b.frontier), dist: name(b.dist),
});
const fnName = (tl: Timeline, ids: number[]) => ids.map((id) => tl.meta.fns[id].name);

describe('graph detection: the bundled examples', () => {
  it('bfs: an adjacency list walked from a queue, with a visited Set', async () => {
    const { tl, d } = await one(example('bfs'));
    expect(d).toMatchObject({ vizId: 'graph', key: `graph:obj:${d.bindings.objId}`, title: 'graph', score: 0.9, role: 'primary' });
    expect(d.mode).toBeUndefined();
    const b = d.bindings;
    expect(b).toMatchObject({ kind: 'list', weighted: false, directed: false, graph: { name: 'graph', fnId: 0 } });
    expect(b.nodes).toEqual(['0', '1', '2', '3', '4', '5'].map((id) => ({ id, label: id })));
    expect(roles(b)).toEqual({ current: 'node', neighbor: 'next', visited: 'visited', frontier: 'queue', dist: undefined });
    expect(b.frontierShape).toEqual({ kind: 'queue' });
    expect(fnName(tl, b.traversalFns)).toEqual(['bfs']);
    // the outer list, its six rows and the variable; never the visited Set or the queue
    expect(d.claims).toContain('0:graph');
    expect(d.claims.filter((c) => c.startsWith('obj:'))).toHaveLength(7);
    expect(d.claims).not.toContain(varKey(b.visited!));
    expect(d.claims).not.toContain(varKey(b.frontier!));
    expect(d.claims.some((c) => c.startsWith('fn:'))).toBe(false);
  });

  it('bfs on the stage: the graph is primary; the queue and the visited Set stay beside it', async () => {
    const shown = await stage(example('bfs'));
    expect(shown[0]).toMatchObject({ vizId: 'graph', role: 'primary' });
    expect(shown.find((x) => x.vizId === 'queue')).toMatchObject({ title: 'queue', role: 'secondary' });
    expect(shown.find((x) => x.vizId === 'hashMap')).toMatchObject({ title: 'visited' });
  });

  it('dfs: an adjacency object walked by a recursive function, which the graph claims', async () => {
    const { tl, d } = await one(example('dfs'));
    const b = d.bindings;
    expect(b).toMatchObject({ kind: 'object', weighted: false, directed: true });
    expect(b.nodes.map((n) => n.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(roles(b)).toEqual({ current: 'node', neighbor: 'next', visited: 'visited', frontier: undefined, dist: undefined });
    expect(fnName(tl, b.traversalFns)).toEqual(['dfs']);
    expect(d.claims).toContain(`fn:${b.traversalFns[0]}`);
  });

  it('dfs on the stage: the graph replaces the recursion tree; the call stack stays', async () => {
    const shown = await stage(example('dfs'));
    expect(shown[0]).toMatchObject({ vizId: 'graph', role: 'primary' });
    expect(shown.some((x) => x.vizId === 'callStack')).toBe(true);
    expect(shown.some((x) => x.vizId === 'recursionTree')).toBe(false);
  });

  it('dijkstra: distances mode over an adjacency built from the edge list, frontier the priority queue', async () => {
    const { d } = await one(example('dijkstra'));
    expect(d.mode).toBe('distances');
    expect(d.title).toBe('adj');
    const b = d.bindings;
    expect(b).toMatchObject({ kind: 'list', weighted: true, directed: false });
    expect(b.nodes.map((n) => n.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(roles(b)).toEqual({ current: 'u', neighbor: 'v', visited: undefined, frontier: 'pq', dist: 'dist' });
    expect(name(b.weight)).toBe('w');
    // `[dist, node]` items: the node is the second element
    expect(b.frontierShape).toEqual({ kind: 'priority', slot: 1 });
    expect(name(b.edgeList?.ref)).toBe('edges');
    // `u` is declared twice (the edge loop, the main loop): the expanded node is the main loop's
    expect(b.current!.bids).toHaveLength(1);
    expect(d.claims).toEqual(expect.arrayContaining(['1:adj', '1:edges', '1:dist', `obj:${b.edgeList!.objId}`]));
    expect(d.claims).not.toContain('1:pq');
  });

  it('dijkstra on the stage: the priority queue stays, the distances get no array view of their own', async () => {
    const shown = await stage(example('dijkstra'));
    expect(shown[0]).toMatchObject({ vizId: 'graph', role: 'primary', mode: 'distances' });
    expect(shown.find((x) => x.vizId === 'queue')).toMatchObject({ title: 'pq', mode: 'priority' });
    expect(shown.some((x) => x.vizId === 'array')).toBe(false);
  });

  it.each(NOT_GRAPH)('%s has no graph', async (id) => {
    expect((await graphs(example(id))).found).toEqual([]);
  });
});

describe('graph detection: other representations and traversals', () => {
  it('an iterative DFS: the stack is the frontier', async () => {
    const { d } = await one(STACK_DFS);
    expect(d.bindings).toMatchObject({ kind: 'list', directed: true, frontierShape: { kind: 'stack' } });
    expect(roles(d.bindings)).toMatchObject({ current: 'node', neighbor: 'next', visited: 'seen', frontier: 'stack' });
  });

  it('an adjacency matrix scanned by a counter; the counter is the neighbor', async () => {
    const { d } = await one(MATRIX_BFS);
    expect(d.bindings).toMatchObject({ kind: 'matrix', directed: false, weighted: false });
    expect(roles(d.bindings)).toMatchObject({ current: 'u', neighbor: 'v', visited: 'visited', frontier: 'queue' });
    const dfs = await one(MATRIX_DFS);
    expect(dfs.d.bindings).toMatchObject({ kind: 'matrix', directed: true });
    expect(fnName(dfs.tl, dfs.d.bindings.traversalFns)).toEqual(['dfs']);
  });

  it('a Map adjacency built from an edge list, walked at the top level', async () => {
    const { d } = await one(MAP_BFS);
    expect(d.bindings).toMatchObject({ kind: 'object', directed: false, traversalFns: [0] });
    expect(d.bindings.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(roles(d.bindings)).toMatchObject({ current: 'cur', neighbor: 'nb', visited: 'visited', frontier: 'queue' });
    expect(name(d.bindings.edgeList?.ref)).toBe('edges');
  });

  it("Kahn's in-degrees count down by one: no distances; the prerequisite pairs are the edge list", async () => {
    const { d } = await one(KAHN);
    expect(d.mode).toBeUndefined();
    expect(roles(d.bindings)).toMatchObject({ current: 'u', neighbor: 'v', frontier: 'queue', dist: undefined, visited: undefined });
    expect(name(d.bindings.edgeList?.ref)).toBe('prerequisites');
  });

  it('neighbors read by index into a variable; a level array starting at -1 marks visits', async () => {
    const { d } = await one(INDEX_BFS);
    expect(d.mode).toBeUndefined();
    expect(roles(d.bindings)).toMatchObject({ current: 'node', neighbor: 'next', visited: 'dist', frontier: 'q' });
  });

  it('forEach over the neighbors: the callback parameter is the neighbor, the callback a traversal function', async () => {
    const { tl, d } = await one(FOREACH_DFS);
    expect(d.bindings).toMatchObject({ kind: 'object', directed: true });
    expect(roles(d.bindings)).toMatchObject({ current: 'node', neighbor: 'next', visited: 'visited' });
    expect(fnName(tl, d.bindings.traversalFns)).toEqual(['dfs', 'callback']);
    expect(d.claims).toContain(`fn:${d.bindings.traversalFns[0]}`);
  });

  it('distances starting at Infinity and lowered as nodes are reached: distances mode', async () => {
    const { d } = await one(BFS_DIST);
    expect(d.mode).toBe('distances');
    expect(roles(d.bindings)).toMatchObject({ current: 'u', neighbor: 'v', frontier: 'queue', dist: 'dist' });
  });

  it('registered ahead of array and dp1d, the graph wins their 0.9 ties: its distances get no DP table', async () => {
    const shown = await stage(BFS_DIST, true);
    expect(shown[0]).toMatchObject({ vizId: 'graph', mode: 'distances' });
    expect(shown.some((x) => x.vizId === 'dp1d' || x.vizId === 'array')).toBe(false);
    expect((await stage(KAHN, true))[0].vizId).toBe('graph');
  });

  it('pairs taken apart in the loop body: the destructured variables are the neighbor and the weight', async () => {
    const { d } = await one(DIJKSTRA_BODY);
    expect(d.mode).toBe('distances');
    expect(roles(d.bindings)).toEqual({ current: 'u', neighbor: 'v', visited: 'done', frontier: 'pq', dist: 'dist' });
    expect(name(d.bindings.weight)).toBe('w');
  });

  it.each([['for-of', BELLMAN], ['fields by index', BELLMAN_FIELDS]])('Bellman-Ford over an edge list (%s): the list is the graph', async (_, code) => {
    const { d } = await one(code);
    expect(d).toMatchObject({ title: 'edges', mode: 'distances' });
    expect(d.bindings).toMatchObject({ kind: 'edges', weighted: true, directed: true });
    expect(d.bindings.nodes.map((n) => n.id)).toEqual(['0', '1', '2', '3']);
    expect(roles(d.bindings)).toMatchObject({ current: 'u', neighbor: 'v', dist: 'dist' });
    expect(name(d.bindings.weight)).toBe('w');
    expect(d.claims).toEqual(expect.arrayContaining(['1:edges', '1:dist']));
  });

  it('an edge list only used to build the adjacency is no graph of its own', async () => {
    const { found } = await graphs(example('dijkstra'));
    expect(found.map((d) => d.bindings.kind)).toEqual(['list']);
  });

  it('a class field graph is named by the instance holding it', async () => {
    const { d } = await one(CLASS_GRAPH);
    expect(d.title).toBe('g.adj');
    expect(roles(d.bindings)).toMatchObject({ current: 'u', neighbor: 'v', visited: 'seen', frontier: 'q' });
  });

  it('a head-index queue keeps its head', async () => {
    const { d } = await one(HEAD_BFS);
    expect(d.bindings.frontierShape).toMatchObject({ kind: 'queue', head: { name: 'head' } });
  });

  it('a square numeric grid walked cell by cell is no matrix graph', async () => {
    expect((await graphs(GRID_BFS)).found).toEqual([]);
  });

  it('nested arrays looped over without a traversal are no graph', async () => {
    expect((await graphs(PAIRS_LOOP)).found).toEqual([]);
  });
});
