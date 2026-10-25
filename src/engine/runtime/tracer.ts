/**
 * The `__as_t` object instrumented code talks to. Builds frames/loops, emits the trace and enforces
 * limits. Limit hits are sticky: every later hook throws ABORT again, so user try/catch can't swallow it.
 */
import type {
  CondEvent, EndEvent, EndStatus, IterEvent, LoopRef, ReadEvent, ReturnEvent, RunLimits, StepEvent, StmtEvent, Sub, TraceEvent,
} from '../types/trace';
import { UNDEF } from '../types/values';
import { formatLogLine, makeConsole } from './format';
import { Membrane } from './membrane';
import { ABORT, LOOP_CALLBACK, LOOP_FOR, LOOP_WHILE, newFrame, errorInfo, type Frame, type LoopState } from './frames';
import { isArray, isView, now } from './primordials';

export { ABORT, errorInfo } from './frames';

const MAX_SUB = 100;
const MAX_READS_PER_STEP = 64;
const FLUSH_EVENTS = 2048;
const FLUSH_MS = 50;

export class Tracer {
  readonly membrane: Membrane;
  readonly console: Record<string, (...args: unknown[]) => void>;
  aborted = false;
  status: EndStatus = 'ok';
  private readonly limits: RunLimits;
  private readonly sink: (events: TraceEvent[]) => void;
  private readonly stack: Frame[] = [];
  private readonly mainFrame: Frame;
  private nextCallId = 1;
  private nextLoopInst = 1;
  private steps = 0;
  private ops = 0;
  private readsThisStep = 0;
  private mute = 0;
  private buf: TraceEvent[] = [];
  private lastFlush: number;
  private readonly t0: number;
  private readonly seenErrors = new WeakSet<object>();
  private propagating: { value: unknown } | null = null;
  private lastThrown: { value: unknown } | null = null;
  private finished = false;

  constructor(limits: RunLimits, sink: (events: TraceEvent[]) => void) {
    this.limits = limits;
    this.sink = sink;
    this.t0 = now();
    this.lastFlush = this.t0;
    this.mainFrame = newFrame(0, 0, 0, null, false);
    this.stack[0] = this.mainFrame;
    this.membrane = new Membrane({ emit: (ev) => this.emit(ev), read: (ev) => this.read(ev) });
    this.console = makeConsole((level, args) => this.log(level, args));
  }

  get stepCount(): number {
    return this.steps;
  }

  // ── plumbing ──
  private get top(): Frame {
    return this.stack[this.stack.length - 1] ?? this.mainFrame;
  }

  private tick(): void {
    if (this.aborted) throw ABORT;
    this.ops += 1;
    if ((this.ops & 255) === 0) {
      const t = now();
      if (t - this.t0 > this.limits.timeoutMs) this.abort('timeout');
      if (t - this.lastFlush > FLUSH_MS) this.flush();
    }
  }

  private abort(status: EndStatus): never {
    this.aborted = true;
    this.status = status;
    throw ABORT;
  }

  emit(ev: TraceEvent): void {
    if (this.aborted) return;
    const b = this.buf;
    b[b.length] = ev;
    if (b.length >= FLUSH_EVENTS) this.flush();
  }

  private read(ev: ReadEvent): void {
    if (this.mute > 0 || this.readsThisStep >= MAX_READS_PER_STEP) return;
    this.readsThisStep += 1;
    this.emit(ev);
  }

  private step(ev: StepEvent): void {
    if (this.mute > 0) return;
    this.steps += 1;
    if (this.steps > this.limits.maxSteps) this.abort('limit-steps');
    this.readsThisStep = 0;
    this.emit(ev);
  }

  flush(): void {
    this.lastFlush = now();
    if (this.buf.length === 0) return;
    const batch = this.buf;
    this.buf = [];
    this.sink(batch);
  }

  private ser(v: unknown) {
    return this.membrane.ser(v);
  }

  private takeSub<E extends { sub?: Sub[] }>(f: Frame, ev: E): E {
    if (f.sub.length) ev.sub = f.sub;
    f.sub = [];
    return ev;
  }

  private ref(L: LoopState): LoopRef {
    return { loopId: L.loopId, inst: L.inst, iteration: L.iteration };
  }

  private log(level: 'log' | 'info' | 'warn' | 'error' | 'debug', args: unknown[]): void {
    this.tick();
    const encoded = args.map((a) => this.ser(a));
    this.emit({ t: 'log', level, args: encoded, text: formatLogLine(args, (x) => this.membrane.unwrap(x)) });
  }

  // ── statements ──
  main(): Frame {
    return this.mainFrame;
  }

  s(sid: number): number {
    this.tick();
    const f = this.top;
    f.stmt = sid;
    f.inst += 1;
    f.sub = [];
    return sid;
  }

  e(sid: number): void {
    this.tick();
    const f = this.top;
    this.step(this.takeSub(f, { t: 'stmt', sid, callId: f.id, inst: f.inst } as StmtEvent));
  }

  d(sid: number, bids: number[], values: unknown[]): void {
    this.tick();
    const f = this.top;
    if (!f.muted) {
      for (let i = 0; i < bids.length; i++) this.emit({ t: 'decl', bid: bids[i], callId: f.id, value: this.ser(values[i]) });
    }
    this.step(this.takeSub(f, { t: 'stmt', sid, callId: f.id, inst: f.inst } as StmtEvent));
  }

  st(sid: number): void {
    this.s(sid);
    this.e(sid);
  }

  c(sid: number, value: unknown): unknown {
    this.tick();
    const f = this.top;
    this.step(this.takeSub(f, { t: 'cond', sid, callId: f.id, inst: f.inst, kind: 'if', value: this.ser(value), result: !!value } as CondEvent));
    return value;
  }

  sw(sid: number, value: unknown): unknown {
    this.tick();
    const f = this.top;
    f.switchSid = sid;
    f.switchHit = false;
    this.step(this.takeSub(f, { t: 'cond', sid, callId: f.id, inst: f.inst, kind: 'switch', value: this.ser(value), result: true } as CondEvent));
    return value;
  }

  cm(sid: number, index: number): void {
    this.tick();
    const f = this.top;
    const fallthrough = f.switchSid === sid && f.switchHit;
    if (f.switchSid === sid) f.switchHit = true;
    this.emit({ t: 'case', sid, index, fallthrough });
  }

  thr(sid: number, value: unknown): unknown {
    this.tick();
    const f = this.top;
    this.lastThrown = { value };
    this.step(this.takeSub(f, { t: 'stmt', sid, callId: f.id, inst: f.inst } as StmtEvent));
    return value;
  }

  ct(sid: number, err: unknown): void {
    this.tick();
    const f = this.top;
    f.stmt = sid;
    f.inst += 1;
    this.propagating = null;
    this.step({ t: 'catch', sid, callId: f.id, inst: f.inst, error: this.ser(err) });
  }

  // ── values ──
  v(eid: number, value: unknown): unknown {
    this.tick();
    const f = this.top;
    if (this.mute === 0 && f.sub.length < MAX_SUB) f.sub[f.sub.length] = [eid, this.ser(value)];
    return value;
  }

  vo(eid: number, value: unknown): unknown {
    const tracked = this.o(value);
    this.v(eid, tracked);
    return tracked;
  }

  o(value: unknown): unknown {
    this.tick();
    return this.membrane.track(value);
  }

  p(value: unknown): unknown {
    return this.o(value);
  }

  np<T>(ctor: T): T {
    this.membrane.markNoProxy(ctor);
    return ctor;
  }

  self(_frame: Frame, thisObj: unknown): unknown {
    return this.o(thisObj);
  }

  a(frame: Frame, bid: number, old: unknown, value: unknown): unknown {
    this.tick();
    if (!frame.muted) this.emit({ t: 'assign', bid, callId: frame.id, old: this.ser(old), value: this.ser(value) });
    return value;
  }

  upd(frame: Frame, bid: number, old: unknown, value: unknown, prefix: boolean): unknown {
    this.a(frame, bid, old, value);
    if (prefix) return value;
    return typeof old === 'bigint' ? old : Number(old);
  }

  // ── functions ──
  enter(fnId: number, lex: Frame | null, params: unknown[]): Frame {
    this.tick();
    const parent = this.top;
    const muted = this.mute > 0;
    const depth = parent.depth + 1;
    if (depth > this.limits.maxDepth) this.abort('limit-depth');
    const f = newFrame(this.nextCallId++, fnId, depth, lex, muted);
    this.stack[this.stack.length] = f;
    if (!muted) {
      const args = new Array(params.length);
      for (let i = 0; i < params.length; i++) args[i] = this.ser(params[i]);
      this.step({
        t: 'call', callId: f.id, parentId: parent.id, lexParentId: lex ? lex.id : null, fnId, args, depth,
        siteSid: parent.stmt, siteInst: parent.inst,
      });
    }
    return f;
  }

  ret(sid: number, frame: Frame, value: unknown): unknown {
    this.tick();
    frame.returned = true;
    if (!frame.muted) {
      this.step(this.takeSub(frame, { t: 'return', callId: frame.id, sid, inst: frame.inst, value: this.ser(value), implicit: false } as ReturnEvent));
    }
    return value;
  }

  ir(frame: Frame, sid: number, value: unknown): void {
    this.tick();
    frame.stmt = sid;
    frame.inst += 1;
    frame.returned = true;
    if (!frame.muted) this.step({ t: 'return', callId: frame.id, sid, inst: frame.inst, value: this.ser(value), implicit: true });
  }

  thrown(frame: Frame, err: unknown): void {
    if (err === ABORT || this.aborted) return;
    if (err !== null && typeof err === 'object') {
      if (this.seenErrors.has(err)) return;
      this.seenErrors.add(err);
    } else if (this.propagating && Object.is(this.propagating.value, err)) {
      return;
    }
    this.propagating = { value: err };
    if (this.lastThrown && Object.is(this.lastThrown.value, err)) {
      this.lastThrown = null;
      return; // the throw statement already produced its step
    }
    this.errorStep(err, frame);
  }

  /** Error that escaped to the top level (runner). */
  uncaught(err: unknown): void {
    if (err === ABORT) return;
    if (err !== null && typeof err === 'object' && this.seenErrors.has(err)) return;
    if (this.propagating && Object.is(this.propagating.value, err)) return;
    if (this.lastThrown && Object.is(this.lastThrown.value, err)) return;
    this.errorStep(err, this.top);
  }

  private errorStep(err: unknown, frame: Frame): void {
    if (frame.muted) return;
    const { name, message } = errorInfo(err);
    try {
      this.step({ t: 'error', name, message, sid: frame.stmt, callId: frame.id, fromThrow: false });
    } catch (e) {
      if (e !== ABORT) throw e;
    }
  }

  /** Runs in `finally`: never throws, also while aborting. */
  exit(frame: Frame): void {
    if (frame.exited) return;
    if (!frame.onStack) {
      frame.exited = true;
      if (!frame.muted) this.emit({ t: 'exit', callId: frame.id, threw: !frame.returned });
      return;
    }
    const st = this.stack;
    while (st.length > 1) {
      const f = st[st.length - 1];
      st.length -= 1;
      f.onStack = false;
      f.exited = true;
      if (!f.muted) this.emit({ t: 'exit', callId: f.id, threw: !f.returned });
      if (f === frame) break;
    }
  }

  suspend(frame: Frame, value: unknown): unknown {
    this.tick();
    if (frame.onStack) {
      const st = this.stack;
      const idx = st.lastIndexOf(frame);
      if (idx > 0) st.splice(idx, 1);
      frame.onStack = false;
      if (!frame.muted) this.emit({ t: 'suspend', callId: frame.id });
    }
    return value;
  }

  resume(frame: Frame, value: unknown): unknown {
    this.tick();
    if (!frame.onStack && !frame.exited) {
      const parent = this.top;
      frame.depth = parent.depth + 1;
      this.stack[this.stack.length] = frame;
      frame.onStack = true;
      if (!frame.muted) this.emit({ t: 'resume', callId: frame.id, parentId: parent.id });
    }
    return value;
  }

  // ── loops ──
  ls(loopId: number, kind: number, frame: Frame): LoopState {
    this.tick();
    const L: LoopState = { inst: this.nextLoopInst++, loopId, kind, frame, iteration: 0, pendingSub: null, active: true };
    frame.loops[frame.loops.length] = L;
    if (!frame.muted && this.mute === 0) this.emit({ t: 'loopStart', loop: this.ref(L), callId: frame.id });
    return L;
  }

  lt(L: LoopState, sid: number, value: unknown): unknown {
    this.tick();
    const result = !!value;
    if (result && (L.kind === LOOP_FOR || L.kind === LOOP_WHILE)) L.iteration += 1;
    const f = this.top;
    this.step(this.takeSub(f, {
      t: 'cond', sid, callId: f.id, inst: f.inst, kind: 'loop', value: this.ser(value), result, loop: this.ref(L),
    } as CondEvent));
    return value;
  }

  li(L: LoopState): void {
    this.tick();
    L.iteration += 1;
    if (!L.frame.muted && this.mute === 0) this.emit({ t: 'loopIter', loop: this.ref(L) });
  }

  /** Runs in `finally`: never throws. */
  le(L: LoopState): void {
    if (!L.active) return;
    L.active = false;
    const loops = L.frame.loops;
    for (let i = loops.length - 1; i >= 0; i--) {
      if (loops[i] === L) {
        for (let j = i; j < loops.length - 1; j++) loops[j] = loops[j + 1];
        loops.length -= 1;
        break;
      }
    }
    if (!L.frame.muted && this.mute === 0) this.emit({ t: 'loopEnd', loop: this.ref(L) });
  }

  fo(L: LoopState, sid: number, iterable: unknown): Iterator<unknown> & Iterable<unknown> {
    this.tick();
    const f = this.top;
    L.pendingSub = f.sub.length ? f.sub : null;
    f.sub = [];
    const it = (iterable as Iterable<unknown>)[Symbol.iterator]();
    const self = this;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next(v?: unknown) {
        const r = it.next(v);
        if (r.done) self.loopDone(L, sid);
        return r;
      },
      return(v?: unknown) {
        return typeof it.return === 'function' ? it.return(v) : { done: true, value: v };
      },
      throw(e?: unknown) {
        if (typeof it.throw === 'function') return it.throw(e);
        throw e;
      },
    };
  }

  private loopDone(L: LoopState, sid: number): void {
    this.tick();
    const f = this.top;
    f.stmt = sid;
    f.inst += 1;
    this.step({ t: 'cond', sid, callId: f.id, inst: f.inst, kind: 'loop', value: UNDEF, result: false, loop: this.ref(L) });
  }

  ib(L: LoopState, sid: number, bids: number[], values: unknown[]): void {
    this.tick();
    const f = this.top;
    f.stmt = sid;
    f.inst += 1;
    L.iteration += 1;
    const bindings = new Array(values.length);
    for (let i = 0; i < values.length; i++) bindings[i] = this.ser(values[i]);
    if (!f.muted) {
      for (let i = 0; i < bids.length; i++) this.emit({ t: 'decl', bid: bids[i], callId: f.id, value: bindings[i] });
    }
    const ev: IterEvent = { t: 'iter', sid, callId: f.id, inst: f.inst, loop: this.ref(L), bindings };
    if (L.pendingSub) {
      ev.sub = L.pendingSub;
      L.pendingSub = null;
    }
    this.step(ev);
  }

  hof(loopId: number, _sid: number, recv: unknown, name: string, fn: unknown, args: unknown[]): unknown {
    this.tick();
    if (typeof fn !== 'function') throw new TypeError(`${name} is not a function`);
    const raw = this.membrane.unwrap(recv);
    const collection = isArray(raw) || raw instanceof Map || raw instanceof Set || isView(raw);
    if (!collection) return Reflect.apply(fn, recv, args);
    if (name === 'sort' || name === 'toSorted') {
      this.mute += 1;
      try {
        return Reflect.apply(fn, recv, args);
      } finally {
        this.mute -= 1;
      }
    }
    const cb = args[0];
    if (typeof cb !== 'function' || loopId < 0) return Reflect.apply(fn, recv, args);
    const L = this.ls(loopId, LOOP_CALLBACK, this.top);
    const self = this;
    const wrapped = function (this: unknown, ...cbArgs: unknown[]) {
      self.li(L);
      return Reflect.apply(cb, this, cbArgs);
    };
    const rest = args.slice(1);
    try {
      return Reflect.apply(fn, recv, [wrapped, ...rest]);
    } finally {
      this.le(L);
    }
  }

  // ── end of run ──
  finish(status: EndStatus, error?: { name: string; message: string }): void {
    if (this.finished) return;
    this.finished = true;
    const ev: EndEvent = { t: 'end', status };
    if (error) ev.error = error;
    this.buf[this.buf.length] = ev;
    this.flush();
  }
}
