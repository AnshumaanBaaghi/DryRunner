/** Slot placement: primary centered, secondaries to the right, aux columns at the sides, never overlapping. */
import { describe, expect, it } from 'vitest';
import { fitDistance } from '../../src/scene/camera';
import { computeLayout, GAP, type SlotSize, type SlotSpec } from '../../src/scene/layout';

describe('computeLayout', () => {
  const specs: SlotSpec[] = [
    { id: 'p', role: 'primary', order: 0 },
    { id: 's', role: 'secondary', order: 1 },
    { id: 'l', role: 'aux', order: 2 },
    { id: 'r', role: 'aux', side: 'right', order: 3 },
    { id: 'l2', role: 'aux', side: 'left', order: 4 },
  ];
  const sizes: Record<string, SlotSize> = {
    p: { w: 6, h: 4, d: 1 }, s: { w: 4, h: 3, d: 1 }, l: { w: 2, h: 2, d: 1 }, r: { w: 3, h: 5, d: 2 }, l2: { w: 2.5, h: 1, d: 1 },
  };

  it('centers the primary and keeps every slot disjoint', () => {
    const { positions, bounds } = computeLayout(specs, sizes);
    expect(positions.p).toEqual([0, 0, 0]);
    // the secondary sits beside the primary or (this row being wide) above it
    expect(positions.s[0] > 3 || positions.s[1] >= sizes.p.h).toBe(true);
    expect(positions.r[0]).toBeGreaterThan(3);
    expect(positions.l[0]).toBeLessThan(-3);
    const box = (id: string) => {
      const [x, y] = positions[id];
      return { x0: x - sizes[id].w / 2, x1: x + sizes[id].w / 2, y0: y, y1: y + sizes[id].h };
    };
    const ids = specs.map((s) => s.id);
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        const A = box(a);
        const B = box(b);
        const overlap = A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1;
        expect(overlap, `${a} overlaps ${b}`).toBe(false);
      }
    }
    for (const id of ids) {
      const b = box(id);
      expect(b.x0).toBeGreaterThanOrEqual(bounds.min[0] - 1e-9);
      expect(b.x1).toBeLessThanOrEqual(bounds.max[0] + 1e-9);
      expect(b.y1).toBeLessThanOrEqual(bounds.max[1] + 1e-9);
    }
  });

  it('uses a default footprint until a slot reports its size', () => {
    const { positions } = computeLayout([{ id: 'a', role: 'primary', order: 0 }, { id: 'b', role: 'secondary', order: 1 }], {});
    expect(positions.a).toEqual([0, 0, 0]);
    expect(positions.b[0] > 2 || positions.b[1] >= 3).toBe(true);
  });

  const two: SlotSpec[] = [{ id: 'p', role: 'primary', order: 0 }, { id: 's', role: 'secondary', order: 1 }];

  it('keeps a secondary beside the primary while the row stays compact', () => {
    const { positions } = computeLayout(two, { p: { w: 4, h: 4, d: 1 }, s: { w: 3, h: 4, d: 1 } });
    expect(positions.s).toEqual([2 + GAP + 1.5, 0, 0]);
  });

  it('wraps secondaries above the primary when the row would be much wider than tall', () => {
    const { positions, bounds } = computeLayout(two, { p: { w: 10, h: 3, d: 1 }, s: { w: 8, h: 3, d: 1 } });
    expect(positions.s[0]).toBeCloseTo(0);
    expect(positions.s[1]).toBeGreaterThan(3);
    expect(bounds.max[0]).toBeCloseTo(5);
    expect(bounds.max[1]).toBeCloseTo(positions.s[1] + 3);
  });
});

describe('fitDistance', () => {
  it('fits height at a 90° field of view (tan 45° = 1)', () => {
    expect(fitDistance([0, 2, 0], 90, 1)).toBeCloseTo(1);
  });

  it('fits width through the aspect ratio and adds half the depth', () => {
    expect(fitDistance([4, 0, 2], 90, 2)).toBeCloseTo(2);
  });
});
