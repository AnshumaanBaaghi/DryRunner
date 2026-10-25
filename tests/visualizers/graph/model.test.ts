/** Per-step graph model: current node, examined edge, frontier, visited and their order, distances, edges present, pulses and focus. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import type { Highlight } from '../../../src/scene/anim';
import { graphVisualizer } from '../../../src/visualizers/graph';
import type { GraphBindings } from '../../../src/visualizers/graph/detect';
import { buildGraphModel, type GraphModel, type NodeState } from '../../../src/visualizers/graph/model';
import { lastStep, timelineOf, valueOf } from '../../helpers/timeline';
import { BELLMAN, DIJKSTRA_BODY, example, FOREACH_DFS, HEAD_BFS, KAHN, MATRIX_BFS, STACK_DFS } from './cases';

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** at step i, having stepped back from i + 1 */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });

async function setup(source: string): Promise<{ tl: Timeline; b: GraphBindings; at: (i: number, hl?: Highlight | null) => GraphModel }> {
  const tl = await timelineOf(source);
  const [d] = graphVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
  return { tl, b: d.bindings, at: (i, hl = null) => buildGraphModel(tl, i, d.bindings, hl) };
}

const inState = (m: GraphModel, state: NodeState) => m.nodes.filter((n) => n.state === state).map((n) => n.id).sort();
const ids = (xs: Iterable<unknown>) => [...xs].map(String).sort();
const stepWhere = (tl: Timeline, src: RegExp, from = 0) => tl.steps.findIndex((s, i) => {
  const st = tl.meta.stmts[s.sid];
  return i >= from && st !== undefined && src.test(tl.meta.source.slice(st.loc.start, st.loc.end));
});

describe('graph model: bfs', () => {
  it('follows the expanded node, the queue (frontier) and the visited Set at every step of the search', async () => {
    const { tl, at } = await setup(example('bfs'));
    let checked = 0;
    let last: string | null = null;
    for (let i = 0; i < tl.steps.length; i++) {
      const queue = valueOf(tl, i, 'queue');
      const visited = valueOf(tl, i, 'visited');
      if (!Array.isArray(queue) || !(visited instanceof Set)) continue;
      const m = at(i);
      const node = valueOf(tl, i, 'node');
      // between iterations (the loop's check) the node expanded last stays current
      last = node === undefined ? last : String(node);
      expect(m.current).toBe(last);
      expect(inState(m, 'frontier')).toEqual(ids(queue));
      expect(inState(m, 'visited')).toEqual(ids([...visited].filter((v) => !queue.includes(v) && String(v) !== last)));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('examines node → next only while the neighbor loop runs', async () => {
    const { tl, at } = await setup(example('bfs'));
    for (let i = 0; i < tl.steps.length; i++) {
      const m = at(i);
      const step = tl.steps[i];
      if (step.kind === 'iter') expect(m.examined).toEqual({ from: String(valueOf(tl, i, 'node')), to: String(valueOf(tl, i, 'next')) });
      if (m.examined) {
        expect(tl.steps[i].loops.some((l) => l.loopId === 1)).toBe(true);
        expect(m.edges.filter((e) => e.state === 'examined')).toHaveLength(1);
      }
      // the loop's last check, and the steps between expansions, examine nothing
      if (step.kind === 'cond' && tl.meta.stmts[step.sid]?.kind === 'forOf') expect(m.examined).toBeNull();
    }
  });

  it('every edge is drawn once (undirected), all from the start; the visit order ends as the BFS order', async () => {
    const { tl, at } = await setup(example('bfs'));
    expect(at(0).exists).toBe(false);
    expect(at(1).edges).toHaveLength(7);
    expect(at(1).edges.every((e) => e.weight === null)).toBe(true);
    const end = at(lastStep(tl));
    expect(end.order).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(end.nodes.map((n) => n.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(end.current).toBeNull();
    expect(inState(end, 'visited')).toHaveLength(6);
  });

  it('pulses the nodes that change state, focuses the current node', async () => {
    const { tl, at } = await setup(example('bfs'));
    const add = stepWhere(tl, /^visited\.add\(next\)/);
    const m = at(add, forward(tl, add));
    expect(m.nodes.filter((n) => n.pulse).map((n) => n.id)).toEqual(['1']);
    expect(at(add).nodes.some((n) => n.pulse)).toBe(false);
    const shift = stepWhere(tl, /queue\.shift/, add);
    const next = at(shift, forward(tl, shift));
    expect(next.current).toBe('1');
    expect(next.focus).toEqual(next.nodes[1].pos);
    // stepping back over the shift: 1 returns to the queue, 0 is current again
    const back = at(shift - 1, backward(tl, shift - 1));
    expect(back.current).toBe('0');
    expect(back.nodes.filter((n) => n.pulse).map((n) => n.id).sort()).toEqual(['0', '1']);
  });
});

describe('graph model: dfs', () => {
  it('the current node is the deepest call; nodes turn visited as their calls add them', async () => {
    const { tl, at } = await setup(example('dfs'));
    for (let i = 0; i < tl.steps.length; i++) {
      const node = valueOf(tl, i, 'node');
      const visited = valueOf(tl, i, 'visited');
      if (!(visited instanceof Set)) continue;
      const m = at(i);
      expect(m.current).toBe(node === undefined ? null : node);
      expect(inState(m, 'visited')).toEqual(ids([...visited].filter((v) => v !== node)));
    }
    expect(at(lastStep(tl)).order).toEqual(valueOf(tl, lastStep(tl), 'order'));
  });

  it('draws the six directed edges', async () => {
    const { tl, at } = await setup(example('dfs'));
    expect(at(lastStep(tl)).edges.map((e) => `${e.from}${e.to}`)).toEqual(['AB', 'AC', 'BD', 'BE', 'CF', 'EF']);
  });
});

describe('graph model: dijkstra', () => {
  it('shows every distance at every step (∞ until reached)', async () => {
    const { tl, at } = await setup(example('dijkstra'));
    let checked = 0;
    for (let i = 0; i < tl.steps.length; i++) {
      const dist = valueOf(tl, i, 'dist');
      if (!Array.isArray(dist)) continue;
      expect(at(i).nodes.map((n) => n.dist)).toEqual(dist.map((d) => (d === Infinity ? '∞' : String(d))));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
    expect(at(lastStep(tl)).nodes.map((n) => n.dist)).toEqual(['0', '3', '1', '4', '7']);
  });

  it('a relaxation shows old → new on the node (stepping back: new → old)', async () => {
    const { tl, at } = await setup(example('dijkstra'));
    const i = tl.diffs.findIndex((d) => d.heap.some((h) => h.op === 'set' && h.path[0] === 1 && h.old === 4));
    const m = at(i, forward(tl, i));
    expect(m.relaxed).toEqual({ node: '1', was: '4', now: '3' });
    expect(m.nodes[1]).toMatchObject({ relax: '4 → 3', pulse: true, dist: '3' });
    expect(at(i).relaxed).toBeNull();
    const back = at(i - 1, backward(tl, i - 1));
    expect(back.relaxed).toEqual({ node: '1', was: '3', now: '4' });
    expect(back.nodes[1].dist).toBe('4');
  });

  it('frontier nodes come from the `[dist, node]` items; weighted edges carry their weights', async () => {
    const { tl, at } = await setup(example('dijkstra'));
    for (let i = 0; i < tl.steps.length; i++) {
      const pq = valueOf(tl, i, 'pq') as [number, number][] | undefined;
      const m = at(i);
      if (Array.isArray(pq)) expect(inState(m, 'frontier')).toEqual(ids(new Set(pq.map(([, v]) => v).filter((v) => String(v) !== m.current))));
    }
    const end = at(lastStep(tl));
    expect(end.edges.map((e) => `${e.from}-${e.to}:${e.weight}`)).toEqual(['0-1:4', '0-2:1', '2-1:2', '1-3:1', '2-3:5', '3-4:3']);
  });

  it('the edge list draws the graph before the adjacency exists; each new adjacency pair flashes once', async () => {
    const { tl, at } = await setup(example('dijkstra'));
    expect(at(1).edges).toHaveLength(6);
    expect(at(1).current).toBeNull();
    const build = tl.diffs.flatMap((d, i) => (d.heap.some((h) => h.op === 'push' && h.id !== undefined) && i < 32 ? [i] : []));
    const flashes = build.map((i) => at(i, forward(tl, i)).edges.filter((e) => e.state === 'added').length);
    // the first push of a pair adds the edge, its reverse push adds nothing new
    expect(flashes).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });
});

describe('graph model: other traversals', () => {
  it('a matrix walk examines only the cells that are edges', async () => {
    const { tl, at } = await setup(MATRIX_BFS);
    let examined = 0;
    for (let i = 0; i < tl.steps.length; i++) {
      const m = at(i);
      if (!m.examined) continue;
      const adj = valueOf(tl, i, 'adj') as number[][];
      expect(adj[Number(m.examined.from)][Number(m.examined.to)]).toBe(1);
      examined += 1;
    }
    expect(examined).toBeGreaterThan(8);
    expect(at(lastStep(tl)).edges).toHaveLength(4);
  });

  it('a head-index queue: items before head are no longer the frontier', async () => {
    const { tl, at } = await setup(HEAD_BFS);
    for (let i = 0; i < tl.steps.length; i++) {
      const queue = valueOf(tl, i, 'queue');
      const head = valueOf(tl, i, 'head');
      if (!Array.isArray(queue) || typeof head !== 'number') continue;
      const m = at(i);
      expect(inState(m, 'frontier')).toEqual(ids(queue.slice(head).filter((v) => String(v) !== m.current)));
    }
  });

  it('forEach: the callback examines its parameter from the node of the call around it', async () => {
    const { tl, at } = await setup(FOREACH_DFS);
    const i = tl.steps.findIndex((s) => s.kind === 'call' && tl.calls.get(s.callId)?.fnId === 2);
    expect(at(i).examined).toEqual({ from: '1', to: '2' });
    expect(at(lastStep(tl)).order).toEqual(['1', '2', '4', '3']);
  });

  it('Bellman-Ford over an edge list: each pass examines the edges in order; reached nodes count as visited', async () => {
    const { tl, at } = await setup(BELLMAN);
    const examined = tl.steps.flatMap((s, i) => (s.kind === 'iter' ? [at(i).examined] : []));
    const pass = ['0>1', '0>2', '2>1', '1>3'];
    expect(examined.map((e) => `${e?.from}>${e?.to}`)).toEqual([...pass, ...pass, ...pass]);
    const end = at(lastStep(tl));
    expect(end.edges.map((e) => `${e.from}>${e.to}:${e.weight}`)).toEqual(['0>1:4', '0>2:1', '2>1:2', '1>3:1']);
    expect(end.nodes.map((n) => n.dist)).toEqual(['0', '3', '1', '4']);
    expect(inState(end, 'visited')).toEqual(['0', '1', '2', '3']);
  });

  it("Kahn's sort draws the edges the way the adjacency points them, not as the prerequisite pairs list them", async () => {
    const { tl, at } = await setup(KAHN);
    expect(at(1).edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['0>1', '0>2', '1>3', '2>3']);
    expect(at(lastStep(tl)).order).toEqual(['0', '1', '2', '3']);
  });
});

describe('graph model: runs cut short', () => {
  it.each([['bfs', example('bfs')], ['dfs', example('dfs')], ['dijkstra', example('dijkstra')], ['stack dfs', STACK_DFS], ['dijkstra, pairs taken apart', DIJKSTRA_BODY],
    ['bellman-ford', BELLMAN]])('%s: every step builds, both ways, at any step limit', async (_, code) => {
    for (const maxSteps of [15, 45]) {
      const tl = await timelineOf(code, { maxSteps });
      for (const d of graphVisualizer.detect({ tl, analysis: analyzeTrace(tl) })) {
        for (let i = 0; i < tl.steps.length; i++) {
          expect(() => buildGraphModel(tl, i, d.bindings, forward(tl, i))).not.toThrow();
          if (i < lastStep(tl)) expect(() => buildGraphModel(tl, i, d.bindings, backward(tl, i))).not.toThrow();
          expect(() => graphVisualizer.describe!(tl, i, d)).not.toThrow();
        }
      }
    }
  });
});
