/** Choosing what the stage shows, and the one-file plugin contract. */
import { describe, expect, it } from 'vitest';
import { registerVisualizer, visualizers } from '../../src/visualizers/registry';
import { detectAll, MAX_ACTIVE, selectDetections } from '../../src/visualizers/select';
import type { AnyVisualizer, Detection } from '../../src/visualizers/types';
import { timelineOf } from '../helpers/timeline';

const det = (vizId: string, key: string, score: number, claims: string[], role: Detection['role'] = 'primary'): Detection => ({
  vizId, key, title: key, score, role, bindings: {}, claims,
});
const fallback = det('scalars', 'scalars', 0.2, []);

describe('selectDetections', () => {
  it('lets higher scores claim variables first and places the rest beside the primary', () => {
    const chosen = selectDetections([det('a', 'a1', 0.9, ['x']), det('b', 'b1', 0.8, ['x']), det('c', 'c1', 0.7, ['y']), fallback]);
    expect(chosen.map((d) => `${d.key}:${d.role}`)).toEqual(['a1:primary', 'c1:secondary']);
  });

  it('falls back to the variables view when nothing structural outscores it', () => {
    expect(selectDetections([fallback, det('array', 'weak', 0.15, ['x'])]).map((d) => d.key)).toEqual(['scalars']);
  });

  it('keeps aux views next to the fallback', () => {
    const chosen = selectDetections([det('hashMap', 'm', 0.7, ['m'], 'aux'), fallback]);
    expect(chosen.map((d) => `${d.key}:${d.role}`)).toEqual(['scalars:primary', 'm:aux']);
  });

  it(`shows at most ${MAX_ACTIVE} views`, () => {
    const many = Array.from({ length: 8 }, (_, k) => det('v', `v${k}`, 0.9 - k * 0.01, [`x${k}`]));
    expect(selectDetections([...many, fallback])).toHaveLength(MAX_ACTIVE);
  });
});

describe('plugin registry', () => {
  it('a new visualizer needs nothing but registration', async () => {
    const dummy: AnyVisualizer = {
      id: 'dummy',
      label: 'Dummy',
      detect: ({ tl }) => [{ vizId: 'dummy', key: 'dummy', title: 'steps', score: 0.99, role: 'primary', bindings: { n: tl.steps.length }, claims: [] }],
      Component: () => null,
    };
    const unregister = registerVisualizer(dummy);
    try {
      expect(() => registerVisualizer(dummy)).toThrow(/already registered/);
      const tl = await timelineOf('let x = 1;\nx++;');
      const [first] = selectDetections(detectAll(tl).all);
      expect(first.vizId).toBe('dummy');
      expect(first.bindings).toEqual({ n: tl.steps.length });
    } finally {
      unregister();
    }
    expect(visualizers().some((v) => v.id === 'dummy')).toBe(false);
  });

  it('reports a failing detector without hiding the others', async () => {
    const broken: AnyVisualizer = { id: 'broken', label: 'Broken', detect: () => { throw new Error('boom'); }, Component: () => null };
    const tl = await timelineOf('let x = 1;');
    const { all, errors } = detectAll(tl, [broken, ...visualizers()]);
    expect(errors).toEqual([{ vizId: 'broken', message: 'boom' }]);
    expect(all.some((d) => d.vizId === 'scalars')).toBe(true);
  });
});
