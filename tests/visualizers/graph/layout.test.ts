/** Force layout: deterministic, inside the 10 × 7 box, nearly flat, spheres apart, few crossings, cached per trace. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { graphVisualizer } from '../../../src/visualizers/graph';
import { edgeShape, frameOf } from '../../../src/visualizers/graph/geometry';
import { BOX, crossings, FLOOR, forceLayout, minSpacing, seeded, type GraphLayout, type Vec3 } from '../../../src/visualizers/graph/layout';
import { graphFrame } from '../../../src/visualizers/graph/model';
import { timelineOf } from '../../helpers/timeline';
import { example } from './cases';

const BFS: [number, number][] = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [3, 5], [4, 5]];
const path = (n: number) => Array.from({ length: n - 1 }, (_, k): [number, number] => [k, k + 1]);
const tree = (n: number) => Array.from({ length: n - 1 }, (_, k): [number, number] => [Math.floor(k / 2), k + 1]);
const rand = seeded(5);
const tangle = Array.from({ length: 140 }, (): [number, number] => [Math.floor(rand() * 90), Math.floor(rand() * 90)]).filter(([a, b]) => a !== b);

function expectInside(l: GraphLayout): void {
  for (const [x, y, z] of l.pos) {
    expect(Math.abs(x) + l.radius).toBeLessThanOrEqual(BOX.w / 2 + 1e-9);
    expect(y - l.radius).toBeGreaterThanOrEqual(FLOOR - 1e-9);
    expect(y + l.radius).toBeLessThanOrEqual(BOX.h + 1e-9);
    expect(Math.abs(z)).toBeLessThanOrEqual(0.8);
  }
  expect(l.width).toBeLessThanOrEqual(BOX.w + 1e-9);
  expect(l.height).toBeLessThanOrEqual(BOX.h + 1e-9);
}

describe('graph force layout', () => {
  it('is the same every time for the same graph', () => {
    expect(forceLayout(6, BFS)).toEqual(forceLayout(6, BFS));
    expect(forceLayout(90, tangle)).toEqual(forceLayout(90, tangle));
  });

  it.each([
    ['the bfs example', 6, BFS], ['a path of 30', 30, path(30)], ['a tree of 31', 31, tree(31)], ['90 tangled nodes', 90, tangle],
  ] as const)('keeps %s inside the box and nearly flat', (_, n, links) => {
    expectInside(forceLayout(n, [...links]));
  });

  it('spreads small graphs without crossings, spheres well apart, edges about one length', () => {
    for (const [n, links] of [[6, BFS], [15, tree(15)], [10, path(10)]] as const) {
      const l = forceLayout(n, [...links]);
      expect(crossings(l.pos, [...links])).toBe(0);
      expect(minSpacing(l.pos)).toBeGreaterThan(3 * l.radius);
      const lengths = links.map(([a, b]) => Math.hypot(l.pos[a][0] - l.pos[b][0], l.pos[a][1] - l.pos[b][1]));
      expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(2.5);
    }
  });

  it('crowded graphs get smaller spheres, never vanishing ones', () => {
    const small = forceLayout(6, BFS);
    const big = forceLayout(90, tangle);
    expect(small.radius).toBeCloseTo(0.36);
    expect(big.radius).toBeLessThan(small.radius);
    expect(big.radius).toBeGreaterThanOrEqual(0.12);
  });

  it('puts the start node toward the upper left and lays the long side horizontally', () => {
    for (const start of [0, 3, 5]) {
      const l = forceLayout(6, BFS, start);
      const [x, y] = l.pos[start];
      expect(x).toBeLessThanOrEqual(1e-9);
      expect(y).toBeGreaterThanOrEqual((Math.min(...l.pos.map((p) => p[1])) + Math.max(...l.pos.map((p) => p[1]))) / 2 - 1e-9);
    }
    const line = forceLayout(10, path(10));
    expect(line.width).toBeGreaterThan(line.height);
  });

  it('handles single nodes and single edges', () => {
    expect(forceLayout(1, []).pos).toHaveLength(1);
    const pair = forceLayout(2, [[0, 1]]);
    expect(Math.hypot(pair.pos[0][0] - pair.pos[1][0], pair.pos[0][1] - pair.pos[1][1])).toBeCloseTo(2.3, 1);
  });

  it('is computed once per trace and starts from the first node expanded', async () => {
    const tl = await timelineOf(example('dfs'));
    const [d] = graphVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
    const frame = graphFrame(tl, d.bindings);
    expect(graphFrame(tl, d.bindings)).toBe(frame);
    expect(frame.layout.pos).toHaveLength(6);
    const a = frame.layout.pos[0];
    expect(a[0]).toBeLessThanOrEqual(1e-9);
    // the same program run again lays out identically
    const again = await timelineOf(example('dfs'));
    const [d2] = graphVisualizer.detect({ tl: again, analysis: analyzeTrace(again) });
    expect(graphFrame(again, d2.bindings).layout).toEqual(frame.layout);
  });
});

describe('graph view geometry', () => {
  const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

  it('runs from surface to surface, the tip just short of the target, the weight above a level edge', () => {
    const e = edgeShape([0, 0, 0], [3, 0, 0], 0.3);
    expect(dist(e.from, [0, 0, 0])).toBeCloseTo(0.3);
    expect(dist(e.to, [3, 0, 0])).toBeCloseTo(0.33);
    expect(e.bend).toBe(0);
    expect(e.label[1]).toBeGreaterThan(0);
  });

  it('two directions of one edge keep apart, each on its own right', () => {
    const ab = edgeShape([0, 0, 0], [3, 0, 0], 0.3, true);
    const ba = edgeShape([3, 0, 0], [0, 0, 0], 0.3, true);
    expect(ab.from[1]).toBeLessThan(0);
    expect(ba.from[1]).toBeGreaterThan(0);
    expect(Math.sign(ab.label[1])).toBe(Math.sign(ab.from[1]));
  });

  it('a self-loop arcs over its node', () => {
    const loop = edgeShape([1, 1, 0], [1, 1, 0], 0.3);
    expect(loop.bend).toBeGreaterThan(0);
    expect(loop.from[1]).toBeGreaterThan(1);
    expect(loop.from[0]).toBeLessThan(loop.to[0]);
  });

  it('reports a footprint holding the nodes and the title above them', () => {
    const l = forceLayout(6, BFS);
    const box = frameOf(l, 4);
    expect(box.w).toBeGreaterThanOrEqual(l.width);
    expect(box.h).toBeGreaterThan(l.height);
    expect(box.title[1]).toBeGreaterThan(Math.max(...l.pos.map((p) => p[1])) + l.radius);
    expect(frameOf(l, 20).w).toBeGreaterThanOrEqual(20);
  });
});
