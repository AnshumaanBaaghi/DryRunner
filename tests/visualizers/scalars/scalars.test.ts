/** Variables & loops fallback: nested loops get the iteration-space grid. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { scalarsVisualizer } from '../../../src/visualizers/scalars';
import { iterationSpace } from '../../../src/visualizers/scalars/iterations';
import { timelineOf } from '../../helpers/timeline';

describe('scalars visualizer', () => {
  it('uses the iteration-space mode for nested loops only', async () => {
    for (const [id, mode] of [['nested-pairs', 'iteration-space'], ['loop-sum', undefined]] as const) {
      const tl = await timelineOf(exampleById(id)!.code);
      const [d] = scalarsVisualizer.detect({ tl, analysis: analyzeTrace(tl) });
      expect(d.mode).toBe(mode);
      expect(d.score).toBe(0.2);
    }
  });

  it('maps every (outer, inner) iteration pair to the step that first reached it', async () => {
    const tl = await timelineOf(exampleById('nested-pairs')!.code);
    const i = tl.steps.findIndex((s) => s.loops.length === 2 && s.loops[1].iteration >= 1);
    const [outer, inner] = tl.steps[i].loops;
    const space = iterationSpace(tl, outer, inner.loopId);
    expect(space.rows).toBe(4);
    expect(space.cols).toBe(3);
    expect([...space.firstStep.keys()]).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2', '3:1']);
    const steps = [...space.firstStep.values()];
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    for (const [key, step] of space.firstStep) {
      const [o, n] = key.split(':').map(Number);
      const loops = tl.steps[step].loops;
      expect(loops[0].iteration).toBe(o);
      expect(loops[1].iteration).toBe(n);
    }
  });
});
