/** Instrumentation must not change program semantics: traced output === native output. */
import { describe, expect, it } from 'vitest';
import { compileAndRun } from '../../src/engine/compileAndRun';
import { runNative } from '../helpers/trace';

const CORPUS: Record<string, string> = {
  treeNode: `class TreeNode { constructor(val) { this.val = val; this.left = null; this.right = null; } }
function insert(root, v) { if (!root) return new TreeNode(v); if (v < root.val) root.left = insert(root.left, v); else root.right = insert(root.right, v); return root; }
let r = null; for (const v of [5, 3, 8, 1]) r = insert(r, v); console.log(r.left.val, r.right.val, r.left.left.val);`,
  derivedClass: `class Base { constructor(x) { this.x = x; } area() { return this.x; } }
class Sq extends Base { constructor(x) { super(x); this.y = x * 2; } area() { return super.area() * this.y; } }
const s = new Sq(3); console.log(s.x, s.y, s.area(), s instanceof Base);`,
  privateFields: `class Counter { #n = 1; inc() { this.#n++; return this.#n; } } const c = new Counter(); console.log(c.inc(), c.inc());`,
  swapDestructuring: `const a = [3, 1, 2]; [a[0], a[1]] = [a[1], a[0]]; let x = 1, y = 2; [x, y] = [y, x]; console.log(a, x, y);`,
  mapSetIdentity: `const m = new Map(); const key = { id: 1 }; m.set(key, [1]); m.get(key).push(2);
const s = new Set([key]); const arr = [key]; console.log(m.get(key), s.has(key), arr.indexOf(key), arr.includes(key), m.size);`,
  closureInRecursion: `function outer(n) { let count = 0; const bump = () => { count++; }; if (n > 0) outer(n - 1); bump(); bump(); return count; } console.log(outer(3));`,
  frozenArray: `const DIRS = Object.freeze([[0, 1], [1, 0], [0, -1]]); let s = 0; for (const [dr, dc] of DIRS) s += dr * 10 + dc; console.log(s, DIRS[1][0], Object.isFrozen(DIRS));`,
  stringAndSetDestructuring: `const [c, d] = '😀a'; const [first, ...rest] = new Set([9, 8, 7]); console.log(c === '😀', d, first, rest);`,
  sortComparatorSideEffects: `let comparisons = 0; const arr = [5, 3, 9, 1, 4]; arr.sort((p, q) => { comparisons++; return p - q; }); console.log(arr, comparisons > 0);`,
  sortDefaultAndHoles: `const a = [10, 9, 1, undefined, 2]; a.sort(); const b = ['b', , 'a']; b.sort(); console.log(a, b.length, 2 in b);`,
  labels: `const out = []; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue outer; if (i === 2) break outer; out.push(i + ':' + j); } } console.log(out);`,
  switchFallthrough: `function f(x) { const out = []; switch (x) { case 1: out.push('one'); case 2: out.push('two'); break; default: out.push('other'); } return out.join(','); } console.log(f(1), f(2), f(3));`,
  useStrict: `'use strict'; function g() { return this === undefined; } console.log(g());`,
  tryFinally: `function f() { try { return 'try'; } finally { console.log('finally'); } } console.log(f());`,
  generators: `function* range(n) { for (let i = 0; i < n; i++) yield i; } const out = []; for (const v of range(4)) { if (v === 3) break; out.push(v); } console.log(out, [...range(2)]);`,
  optionalChaining: `const o = { a: { b: 1, f() { return 2; } } }; const n = null; console.log(o?.a?.b, n?.a.b, n?.a?.(), o.a.f?.(), o.missing?.x);`,
  implicitGlobal: `function f() { total = 5; total += 1; } f(); console.log(total);`,
  defaultParams: `function f(a, b = a * 2, cb = (x) => x + 1, { k = 3 } = {}) { return cb(b) + k; } console.log(f(3), f(1, 1));`,
  arrowClassFields: `class Stack { items = []; push = (x) => this.items.push(x); pop() { return this.items.pop(); } } const s = new Stack(); s.push(1); s.push(2); console.log(s.pop(), s.items.length);`,
  typedArrays: `const t = new Int32Array(4); t[0] = 5; t.fill(2, 1); t[3] = 3.9; console.log(Array.from(t), t.length);`,
  sparseArrays: `const a = [1, , 3]; a.length = 5; a[7] = 1; console.log(a.length, 1 in a, a.filter(() => true).length);`,
  gettersSetters: `const o = { _v: 1, get v() { return this._v * 10; }, set v(x) { this._v = x; } }; o.v = 4; console.log(o.v, o._v);`,
  higherOrder: `const nums = [1, 2, 3]; const doubled = nums.map((x) => x * 2); const total = doubled.reduce((acc, x) => acc + x, 0);
nums.forEach((n, i) => { doubled[i] += n; }); const big = nums.filter((x) => x > 1).some((x) => x === 3); console.log(total, doubled, big, nums.find((x) => x > 1));`,
  reduceNoInit: `console.log([[1], [2], [3]].reduce((acc, x) => acc.concat(x)), [5].reduce((a, b) => a + b));`,
  spreadAndRest: `function f(...args) { args.push(0); return args; } const a = [1, 2]; const b = [...a, ...f(3)]; const { x, ...others } = { x: 1, y: 2, z: 3 }; others.w = 4; console.log(b, x, others);`,
  dpTable: `const n = 4; const dp = Array.from({ length: n }, () => new Array(n).fill(0));
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dp[i][j] = (i && j) ? dp[i - 1][j] + dp[i][j - 1] : 1; console.log(dp[3][3], dp[2]);`,
  linkedListReverse: `class ListNode { constructor(v, next = null) { this.val = v; this.next = next; } }
let head = new ListNode(1, new ListNode(2, new ListNode(3))); let prev = null, cur = head;
while (cur) { const nxt = cur.next; cur.next = prev; prev = cur; cur = nxt; } const vals = []; for (let p = prev; p; p = p.next) vals.push(p.val); console.log(vals);`,
  mapIteration: `const m = new Map([['a', 1], ['b', 2]]); const out = []; for (const [k, v] of m) out.push(k + v); m.forEach((v, k) => out.push(v + k)); console.log(out, [...m.keys()], [...m.values()]);`,
  structuredCloneAndJson: `const g = [[1, 2], [3]]; const c = structuredClone(g); c[0].push(9); console.log(g, c, JSON.stringify({ g }));`,
  seededRandomIsStable: `const xs = [Math.random(), Math.random()]; console.log(xs.every((x) => x >= 0 && x < 1), xs[0] !== xs[1]);`,
  errorMessages: `function f(o) { return o.x.y; } try { f({}); } catch (e) { console.log('caught', e.message); }`,
  throwPrimitive: `function f() { throw 'boom'; } try { f(); } catch (e) { console.log(e); }`,
  classStatics: `class A { static count = 0; static make() { A.count++; return new A(); } } A.make(); A.make(); console.log(A.count);`,
  arguments: `function f() { return arguments.length + arguments[0]; } console.log(f(5, 6));`,
  objectMethodsAndThis: `const counter = { n: 0, inc() { this.n++; return this; } }; counter.inc().inc(); console.log(counter.n);`,
  forIn: `const o = { a: 1, b: 2 }; const keys = []; for (const k in o) keys.push(k); console.log(keys);`,
  doWhile: `let i = 0; do { i += 2; } while (i < 5); console.log(i);`,
  nestedTernaryAndLogical: `const f = (x) => x > 0 ? (x > 10 ? 'big' : 'small') : x === 0 || 'neg'; console.log(f(20), f(5), f(0), f(-1), null ?? 'd', 0 || 'z', 1 && 2);`,
  logicalAssignment: `let a = null; a ??= 5; let b = 1; b ||= 9; let c = 1; c &&= 7; let d = 0; d &&= 3; console.log(a, b, c, d);`,
  postfixCoercion: `let s = '5'; const r = s++; let big = 10n; const r2 = big++; console.log(typeof r, r, s, r2, big);`,
  bigintAndSymbols: `const k = Symbol('k'); const o = { [k]: 1 }; console.log(o[k], 2n ** 10n, typeof k);`,
};

describe('differential: instrumented output equals native output', () => {
  for (const [name, source] of Object.entries(CORPUS)) {
    it(name, async () => {
      const native = runNative(source);
      const r = await compileAndRun(source, { maxSteps: 20_000, timeoutMs: 5_000 });
      if (!r.ok) throw new Error(`compile error: ${r.error.message}`);
      const logs = r.events.filter((e) => e.t === 'log').map((e) => (e as { text: string }).text);
      const traced = r.summary.error ? [...logs, `THROW ${r.summary.error.message}`] : logs;
      expect(r.summary.status === 'ok' || r.summary.status === 'error').toBe(true);
      expect(traced).toEqual(native);
    });
  }
});
