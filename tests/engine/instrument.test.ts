import { describe, expect, it } from 'vitest';
import { instrument } from '../../src/engine/instrument';

function meta(source: string) {
  const r = instrument(source);
  if (!r.ok) throw new Error(r.error.message);
  return r.meta;
}

describe('instrumenter: friendly compile errors', () => {
  it('reports syntax errors with a location', () => {
    const r = instrument('let x = ;');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(1);
      expect(r.error.col).toBe(8);
      expect(r.error.message).not.toMatch(/\(\d+:\d+\)$/);
    }
  });

  it.each([
    ['async function f() {}', /async/],
    ['function f() { return eval("1"); }', /eval/],
    ['import x from "y";', /import/],
    ['with (o) { x; }', /with|strict|Unexpected/],
    ['const __as_t = 1;', /reserved/],
  ])('rejects %s', (source, message) => {
    const r = instrument(source);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(message);
  });
});

describe('instrumenter: program metadata', () => {
  it('names functions, flattens params and detects self recursion', () => {
    const m = meta(`function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
const add = (a, { b }, ...rest) => a + b;
class TreeNode { constructor(val) { this.val = val; this.left = null; } insert(v) { return this.insert(v); } }`);
    const byName = Object.fromEntries(m.fns.map((f) => [f.name, f]));
    expect(byName.fib.selfRef).toBe(true);
    expect(byName.fib.params).toEqual(['n']);
    expect(byName.add.params).toEqual(['a', 'b', 'rest']);
    expect(byName.add.selfRef).toBe(false);
    expect(byName.TreeNode.kind).toBe('ctor');
    expect(byName.insert.selfRef).toBe(true);
    expect(m.analysis.classes[0]).toMatchObject({ name: 'TreeNode', fields: ['val', 'left'], methods: ['insert'] });
  });

  it('records loops with counters, nesting and callback loops', () => {
    const m = meta(`for (let i = 0; i < 3; i++) { for (let j = i; j < 3; j++) {} }
let k = 0; while (k < 10) { k += 2; }
[1, 2].forEach((x) => x);`);
    expect(m.loops.map((l) => [l.kind, l.counters, l.parent])).toEqual([
      ['for', ['i'], null],
      ['for', ['j'], 0],
      ['while', ['k'], null],
      ['callback', [], null],
    ]);
    expect(m.loops[3].method).toBe('forEach');
    expect(m.fns.find((f) => f.isCallback)).toBeDefined();
  });

  it('collects index usage and method calls for the detector', () => {
    const m = meta(`function f(s) { let left = 0; const seen = new Map(); for (let right = 0; right < s.length; right++) { seen.set(s[right], right); left = Math.max(left, s[left + 1] ? 1 : 0); } }`);
    expect(m.analysis.indexUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({ object: 's', index: 'right' }),
      expect.objectContaining({ object: 's', index: 'left' }),
    ]));
    expect(m.analysis.methodCalls).toEqual(expect.arrayContaining([expect.objectContaining({ object: 'seen', method: 'set' })]));
  });

  it('knows whether the program calls anything at top level', () => {
    expect(meta('function f(x) { return x; }').analysis.hasTopLevelCall).toBe(false);
    expect(meta('function f(x) { return x; } f(1);').analysis.hasTopLevelCall).toBe(true);
    expect(meta('let s = 0; for (let i = 0; i < 3; i++) s += i;').analysis.hasTopLevelCall).toBe(true);
    expect(meta('var twoSum = function (nums, target) {};').analysis.functions.map((f) => f.name)).toEqual(['twoSum']);
  });

  it('scopes block bindings to their loop', () => {
    const m = meta('for (let i = 0; i < 2; i++) { const sq = i * i; } let after = 1;');
    const byName = Object.fromEntries(m.bindings.map((b) => [b.name, b]));
    expect(byName.i.loopId).toBe(0);
    expect(byName.sq.loopId).toBe(0);
    expect(byName.after.loopId).toBeUndefined();
  });
});
