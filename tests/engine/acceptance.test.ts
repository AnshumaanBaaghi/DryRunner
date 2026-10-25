import { describe, expect, it } from 'vitest';
import type { AssignEvent, CondEvent, DeclEvent } from '../../src/engine/types/trace';
import { trace } from '../helpers/trace';

const LOOP_SUM = `let sum = 0;
for (let i = 0; i < 5; i++) {
  sum += i;
}`;

describe('acceptance: simple-loop dry run', () => {
  it('produces exactly 19 steps with every iteration, change and check', async () => {
    const t = await trace(LOOP_SUM);
    const kinds = t.steps.map((s) => s.t);
    expect(t.steps).toHaveLength(19);
    expect(kinds[18]).toBe('end');

    const stmtKind = (i: number) => {
      const s = t.steps[i] as { sid?: number };
      return s.sid === undefined ? null : t.meta.stmts[s.sid].kind;
    };
    expect(stmtKind(0)).toBe('decl'); // let sum = 0
    expect(stmtKind(1)).toBe('loopInit'); // let i = 0
    for (let k = 0; k < 5; k++) {
      expect(stmtKind(2 + k * 3)).toBe('loopTest');
      expect(stmtKind(3 + k * 3)).toBe('expr'); // sum += i
      expect(stmtKind(4 + k * 3)).toBe('loopUpdate'); // i++
    }
    expect(stmtKind(17)).toBe('loopTest');

    // condition checks: true ×5 (iterations 1..5), then 5 < 5 → false after 5 iterations
    const checks = t.steps.filter((s): s is CondEvent => s.t === 'cond');
    expect(checks.map((c) => c.result)).toEqual([true, true, true, true, true, false]);
    expect(checks.map((c) => c.loop?.iteration)).toEqual([1, 2, 3, 4, 5, 5]);
    const last = checks[5];
    const iValue = last.sub?.find(([eid]) => t.meta.exprs[eid].type === 'Identifier')?.[1];
    expect(iValue).toBe(5);

    // sum: 0 → 0 → 1 → 3 → 6 → 10
    const sumBid = t.meta.bindings.find((b) => b.name === 'sum')?.id;
    const sumDecl = t.events.find((e): e is DeclEvent => e.t === 'decl' && e.bid === sumBid);
    const sumAssigns = t.events.filter((e): e is AssignEvent => e.t === 'assign' && e.bid === sumBid);
    expect(sumDecl?.value).toBe(0);
    expect(sumAssigns.map((a) => [a.old, a.value])).toEqual([[0, 0], [0, 1], [1, 3], [3, 6], [6, 10]]);

    // i: 0 → 1 → 2 → 3 → 4 → 5
    const iBid = t.meta.bindings.find((b) => b.name === 'i')?.id;
    const iAssigns = t.events.filter((e): e is AssignEvent => e.t === 'assign' && e.bid === iBid);
    expect(iAssigns.map((a) => a.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts nested loop iterations per loop instance', async () => {
    const t = await trace(`for (let i = 0; i < 2; i++) {
  for (let j = 0; j < 3; j++) {
    console.log(i, j);
  }
}`);
    expect(t.logs).toEqual(['0 0', '0 1', '0 2', '1 0', '1 1', '1 2']);
    const inner = t.steps.filter((s): s is CondEvent => s.t === 'cond' && s.loop?.loopId === 1);
    const instances = [...new Set(inner.map((c) => c.loop?.inst))];
    expect(instances).toHaveLength(2);
    for (const inst of instances) {
      expect(inner.filter((c) => c.loop?.inst === inst).map((c) => c.loop?.iteration)).toEqual([1, 2, 3, 3]);
    }
  });
});
