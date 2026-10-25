import { describe, expect, it } from 'vitest';
import { nextBreakpoint, nextIteration, runToLine, stepInto, stepOut, stepOver } from '../../src/engine/timeline/navigation';
import { evaluateWatch } from '../../src/engine/watch/evaluate';
import { timelineOf } from '../helpers/timeline';

const FIB = `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
const r = fib(3);
console.log(r);`;

const NESTED = `let pairs = 0;
for (let i = 0; i < 2; i++) {
  for (let j = 0; j < 3; j++) {
    pairs++;
  }
}`;

describe('navigation', () => {
  it('step over at a call step skips the whole call', async () => {
    const tl = await timelineOf(FIB);
    expect(tl.steps[1].kind).toBe('call');
    const j = stepOver(tl, 1);
    expect(tl.steps[j].kind).toBe('stmt'); // `const r = fib(3)` completes
    expect(tl.steps[j].line).toBe(5);
  });

  it('step over inside a frame skips nested calls', async () => {
    const tl = await timelineOf(FIB);
    const cond = 2; // if (n <= 1) in fib(3)
    expect(tl.steps[cond].kind).toBe('cond');
    const j = stepOver(tl, cond);
    expect(tl.steps[j].callId).toBe(tl.steps[cond].callId);
    expect(tl.steps[j].kind).toBe('return');
  });

  it('step into enters the next call of the next statement, else steps', async () => {
    const tl = await timelineOf(FIB);
    expect(tl.steps[stepInto(tl, 2)].kind).toBe('call');
    expect(stepInto(tl, 1)).toBe(2);
  });

  it('step out lands on the first step after the frame exits', async () => {
    const tl = await timelineOf(FIB);
    const inner = tl.steps.findIndex((s, i) => i > 3 && s.kind === 'cond' && s.depth === 2);
    const out = stepOut(tl, inner);
    expect(tl.steps[out].depth).toBeLessThanOrEqual(2);
    expect(tl.calls.get(tl.steps[inner].callId)?.exitStep).toBe(out);
  });

  it('next iteration moves through the innermost loop, then escalates to the outer loop', async () => {
    const tl = await timelineOf(NESTED);
    const firstInner = tl.steps.findIndex((s) => s.kind === 'cond' && s.loops.length === 2);
    const j1 = nextIteration(tl, firstInner);
    expect(tl.steps[j1].loops.at(-1)?.iteration).toBe(2);
    const j2 = nextIteration(tl, j1);
    const j3 = nextIteration(tl, j2); // inner final check (3 < 3 → false)
    expect(tl.steps[j3].ev).toMatchObject({ t: 'cond', result: false });
    const j4 = nextIteration(tl, j3); // escalates: next outer iteration
    expect(tl.steps[j4].loops).toHaveLength(1);
    expect(tl.steps[j4].loops[0].iteration).toBe(2);
  });

  it('run to line and breakpoints use first touches (for headers stop on checks only)', async () => {
    const tl = await timelineOf(NESTED);
    const hits: number[] = [];
    let i = 0;
    for (;;) {
      const j = runToLine(tl, i, 3);
      if (j === null) break;
      hits.push(j);
      i = j;
    }
    expect(hits).toHaveLength(2 * (1 + 4)); // per outer iteration: inner init + 4 checks
    const bp = nextBreakpoint(tl, 0, [{ line: 4 }]);
    expect(tl.steps[bp ?? 0].line).toBe(4);
  });

  it('conditional breakpoints evaluate against the state before the step', async () => {
    const tl = await timelineOf(NESTED);
    const evalCond = (expr: string, before: number, callId: number) => {
      const r = evaluateWatch(tl, before, expr, callId);
      return r.ok && Boolean(r.value);
    };
    const j = nextBreakpoint(tl, 0, [{ line: 4, condition: 'i === 1 && j === 2' }], evalCond);
    expect(j).not.toBeNull();
    const before = evaluateWatch(tl, (j ?? 1) - 1, 'pairs');
    expect(before.ok && before.value).toBe(5);
  });
});
