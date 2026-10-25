/** Call-stack plugin: shown for nested user calls only (callbacks don't count as frames), and its HUD lines. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import { callStackVisualizer } from '../../../src/visualizers/callStack';
import { timelineOf } from '../../helpers/timeline';

const detect = (tl: Timeline) => callStackVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
const example = (id: string) => timelineOf(exampleById(id)!.code);

describe('call stack detection', () => {
  it.each(['fibonacci', 'fibonacci-memo', 'factorial', 'max-depth', 'dfs', 'islands', 'quick-sort', 'merge-sort', 'n-queens'])(
    'shows the stack for nested calls (%s)',
    async (id) => {
      expect(detect(await example(id))).toEqual([{
        vizId: 'callStack', key: 'callStack', title: 'call stack', score: 0.5, role: 'aux', side: 'right', bindings: {}, claims: [],
      }]);
    },
  );

  it.each(['loop-sum', 'nested-pairs', 'two-sum-sorted', 'binary-search', 'bubble-sort', 'longest-substring'])(
    'stays hidden without nested calls (%s)',
    async (id) => {
      expect(detect(await example(id))).toEqual([]);
    },
  );

  it('does not count callbacks as frames', async () => {
    const sources = [
      'function double(x) {\n  return x * 2;\n}\nconst out = [1, 2].map((v) => double(v));',
      'function grid(n) {\n  return Array.from({ length: n }, () => new Array(n).fill(0));\n}\ngrid(2);',
    ];
    for (const source of sources) expect(detect(await timelineOf(source))).toEqual([]);
    expect(detect(await example('lcs'))).toEqual([]);
  });

  it('counts user calls made through a callback', async () => {
    const tl = await timelineOf('function leaf(x) {\n  return x;\n}\nfunction walk(xs) {\n  xs.forEach((x) => leaf(x));\n}\nwalk([1, 2]);');
    const [d, ...rest] = detect(tl);
    expect(rest).toEqual([]);
    expect(tl.steps.flatMap((_, i) => callStackVisualizer.describe!(tl, i, d))).toEqual([]);
  });
});

describe('call stack HUD lines', () => {
  it('stays quiet for ordinary calls and returns (the narration covers them)', async () => {
    const tl = await example('fibonacci');
    const [d] = detect(tl);
    expect(tl.steps.flatMap((_, i) => callStackVisualizer.describe!(tl, i, d))).toEqual([]);
  });

  it('lists the frames an exception unwinds', async () => {
    const tl = await timelineOf(`function f(n) {
  if (n === 0) throw new Error('boom');
  return f(n - 1);
}
try {
  f(2);
} catch (e) {
  console.log('caught');
}`);
    const [d] = detect(tl);
    const i = tl.steps.findIndex((s) => s.kind === 'catch');
    expect(callStackVisualizer.describe!(tl, i, d)).toEqual(['exception unwound f(0), f(1), f(2)']);
  });
});
