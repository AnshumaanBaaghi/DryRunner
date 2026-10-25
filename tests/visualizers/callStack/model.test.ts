/** Per-step call-stack model: frames bottom → top, their states, frames entering and leaving, locals, the cap. */
import { describe, expect, it } from 'vitest';
import { callLabel } from '../../../src/engine/describe/narrate';
import type { Timeline } from '../../../src/engine/timeline/types';
import { exampleById } from '../../../src/examples';
import type { Highlight } from '../../../src/scene/anim';
import { buildStackModel, clip, localsLine, MAX_FRAMES } from '../../../src/visualizers/callStack/model';
import { timelineOf } from '../../helpers/timeline';

const forward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i], reversed: false, key: `f${i}` });
/** at step i, having stepped back from i + 1 */
const backward = (tl: Timeline, i: number): Highlight => ({ diff: tl.diffs[i + 1], reversed: true, key: `b${i + 1}` });
const labels = (frames: { label: string }[]) => frames.map((f) => f.label);

const THROWS = `function f(n) {
  if (n === 0) throw new Error('boom');
  return f(n - 1);
}
try {
  f(2);
} catch (e) {
  console.log('caught');
}`;

describe('call stack model', () => {
  it('lists the frames bottom to top with the current call on top', async () => {
    const tl = await timelineOf(exampleById('fibonacci')!.code);
    for (let i = 0; i < tl.steps.length; i++) {
      const snap = tl.snapshots[i];
      const stack = snap.frames.toArray().filter((f) => f.callId !== 0);
      const m = buildStackModel(tl, i, null);
      expect(labels(m.frames)).toEqual(stack.map((f) => callLabel(tl, snap, f.callId)));
      expect(m.frames.map((f) => f.slot)).toEqual(stack.map((_, k) => k));
      expect(m.frames.slice(0, -1).every((f) => f.state === 'waiting')).toBe(true);
      const top = stack[stack.length - 1];
      if (top) expect(m.frames[m.frames.length - 1].state).toBe(top.status === 'returning' ? 'returning' : 'active');
      expect(m.hiddenBelow).toBe(0);
      expect(m.leaving).toEqual([]);
    }
  });

  it('a call drops a new frame on top; stepping back over it lifts that frame off', async () => {
    const tl = await timelineOf(exampleById('fibonacci')!.code);
    const i = tl.steps.findIndex((s) => s.kind === 'call' && s.depth === 2);
    const m = buildStackModel(tl, i, forward(tl, i));
    expect(m.frames).toMatchObject([
      { label: 'fib(5)', state: 'waiting', isNew: false, slot: 0 },
      { label: 'fib(4)', state: 'active', isNew: true, slot: 1, changedLocals: [] },
    ]);
    expect(m.leaving).toEqual([]);
    const back = buildStackModel(tl, i - 1, backward(tl, i - 1));
    expect(back.frames).toMatchObject([{ label: 'fib(5)', state: 'active', isNew: false }]);
    expect(back.leaving).toMatchObject([{ label: 'fib(4)', state: 'active', slot: 1, isNew: false }]);
  });

  it('a return lifts the finished frame off with its value; stepping back drops it in again', async () => {
    const tl = await timelineOf(exampleById('fibonacci')!.code);
    // fib(1) returned at the step before: it is popped as its sibling fib(0) is called
    const i = tl.diffs.findIndex((d) => d.popped.length > 0 && d.pushed.length > 0);
    const before = buildStackModel(tl, i - 1, forward(tl, i - 1));
    expect(before.frames[4]).toMatchObject({ label: 'fib(1)', state: 'returning', returnText: '1' });
    const m = buildStackModel(tl, i, forward(tl, i));
    expect(m.frames[4]).toMatchObject({ label: 'fib(0)', state: 'active', isNew: true });
    expect(m.leaving).toMatchObject([{ label: 'fib(1)', state: 'returning', returnText: '1', slot: 4, isNew: false }]);
    const back = buildStackModel(tl, i - 1, backward(tl, i - 1));
    expect(back.frames[4]).toMatchObject({ label: 'fib(1)', state: 'returning', returnText: '1', isNew: true });
    expect(back.leaving).toMatchObject([{ label: 'fib(0)', state: 'active', slot: 4 }]);
  });

  it('marks the throwing frame and lifts the unwound frames off in red', async () => {
    const tl = await timelineOf(THROWS);
    const i = tl.steps.findIndex((s) => s.kind === 'stmt' && tl.meta.stmts[s.sid]?.kind === 'throw');
    expect(buildStackModel(tl, i, forward(tl, i)).frames.map((f) => `${f.label}:${f.state}`)).toEqual(['f(2):waiting', 'f(1):waiting', 'f(0):threw']);
    const caught = buildStackModel(tl, i + 1, forward(tl, i + 1));
    expect(caught.frames).toEqual([]);
    expect(caught.leaving.map((f) => `${f.label}:${f.state}:${f.slot}`)).toEqual(['f(2):threw:0', 'f(1):threw:1', 'f(0):threw:2']);
    expect(caught.leaving.every((f) => f.returnText === undefined)).toBe(true);
    // a runtime error (not a throw statement) marks its frame too
    const te = await timelineOf('function bad(o) {\n  return o.x.y;\n}\nfunction run() {\n  return bad({});\n}\ntry {\n  run();\n} catch (e) {}');
    const err = te.steps.findIndex((s) => s.kind === 'error');
    expect(buildStackModel(te, err, forward(te, err)).frames.map((f) => `${f.label}:${f.state}`)).toEqual(['run():waiting', 'bad({…}):threw']);
  });

  it('shows up to four locals in declaration order, without functions, as short previews', async () => {
    const tl = await timelineOf(`function f(a, b) {
  const c = 3;
  const d = 'a long string';
  let e = 5;
  const g = () => e;
  return g();
}
f(1, 2);`);
    const i = tl.steps.findIndex((s) => s.kind === 'call' && tl.meta.fns[tl.calls.get(s.callId)!.fnId].name === 'g');
    const [caller, callee] = buildStackModel(tl, i, forward(tl, i)).frames;
    expect(caller).toMatchObject({ label: 'f(1, 2)', state: 'waiting', locals: ['a = 1', 'b = 2', 'c = 3', "d = 'a long str…'"] });
    expect(callee).toMatchObject({ label: 'g()', locals: [] });
  });

  it('highlights the locals that changed at this step in existing frames', async () => {
    const tl = await timelineOf(exampleById('n-queens')!.code);
    const colOf = (i: number) => tl.diffs[i].vars.find((c) => c.kind === 'changed' && tl.meta.bindings[c.bid].name === 'col');
    const i = tl.steps.findIndex((_, k) => colOf(k) !== undefined);
    const change = colOf(i)!;
    const frame = buildStackModel(tl, i, forward(tl, i)).frames.find((f) => f.callId === change.callId)!;
    expect(frame.changedLocals).toContain('col');
    expect(frame.locals).toContain(`col = ${change.value}`);
    for (let k = 0; k < tl.steps.length; k++) {
      for (const f of buildStackModel(tl, k, forward(tl, k)).frames) {
        if (f.isNew) expect(f.changedLocals).toEqual([]);
      }
    }
  });

  it('skips callback frames', async () => {
    const tl = await timelineOf('function visit(n) {\n  [n].forEach((k) => {\n    if (k > 0) visit(k - 1);\n  });\n}\nvisit(2);');
    const deepest = tl.steps.findIndex((s) => s.kind === 'call' && tl.calls.get(s.callId)!.args[0] === 0);
    const m = buildStackModel(tl, deepest, forward(tl, deepest));
    expect(labels(m.frames)).toEqual(['visit(2)', 'visit(1)', 'visit(0)']);
    // inside a callback the user frame running it stays the current one
    const inCallback = tl.steps.findIndex((s) => s.kind === 'cond' && tl.meta.fns[tl.calls.get(s.callId)!.fnId].isCallback);
    expect(buildStackModel(tl, inCallback, null).frames.map((f) => `${f.label}:${f.state}`)).toEqual(['visit(2):active']);
  });

  it(`draws the top ${MAX_FRAMES} frames and counts the rest`, async () => {
    const tl = await timelineOf('function down(n) {\n  if (n === 0) return 0;\n  return down(n - 1);\n}\ndown(15);');
    const deepest = tl.steps.findIndex((s) => s.kind === 'call' && tl.calls.get(s.callId)!.args[0] === 0);
    const m = buildStackModel(tl, deepest, forward(tl, deepest));
    expect(m.hiddenBelow).toBe(16 - MAX_FRAMES);
    expect(labels(m.frames)).toEqual(Array.from({ length: MAX_FRAMES }, (_, k) => `down(${MAX_FRAMES - 1 - k})`));
    expect(m.frames.map((f) => f.slot)).toEqual(Array.from({ length: MAX_FRAMES }, (_, k) => k));
  });
});

describe('call stack text fitting', () => {
  it('lays locals out on one line, marking changed ones and eliding what does not fit', () => {
    expect(localsLine({ locals: ['n = 3'], changedLocals: [] }, 28)).toEqual([{ text: 'n = 3', at: 0, changed: false }]);
    expect(localsLine({ locals: ['row = 1', 'col = 2'], changedLocals: ['col'] }, 28)).toEqual([
      { text: 'row = 1,', at: 0, changed: false },
      { text: 'col = 2', at: 9, changed: true },
    ]);
    const long = localsLine({ locals: ['grid = […4]', 'rows = 4', 'cols = 5', 'count = 0'], changedLocals: [] }, 28);
    expect(long.map((s) => s.text)).toEqual(['grid = […4],', 'rows = 4,', '…']);
    expect(long.every((s) => s.at + s.text.length <= 28)).toBe(true);
    expect(localsLine({ locals: ["s = 'abcdefghij…'", 'k = 1'], changedLocals: ['s'] }, 10)).toEqual([{ text: "s = 'abcd…", at: 0, changed: true }]);
    expect(localsLine({ locals: [], changedLocals: [] }, 28)).toEqual([]);
  });

  it('clips text with an ellipsis', () => {
    expect(clip('fib(3)', 10)).toBe('fib(3)');
    expect(clip('quickSort([…8], 0, 7)', 10)).toBe('quickSort…');
    expect(clip('abc', 1)).toBe('…');
  });
});
