/**
 * Folds the event stream into a Timeline incrementally (batches can arrive while the program runs).
 * Fold-forward rule: every non-step event belongs to the next step-creating event.
 */
import { List, Map as IMap } from 'immutable';
import type { Loc, ProgramMeta } from '../types/meta';
import { sameV, UNDEF, type V } from '../types/values';
import type { LoopRef, StepEvent, TraceEvent } from '../types/trace';
import { applyMutation, fromSerialized, orElse } from './heap';
import type { FrameSnap, HeapObj, LoopSnap, StepDiff, StepRecord, Timeline, VarSlot } from './types';

const emptyDiff = (): StepDiff => ({
  vars: [], heap: [], reads: [], pushed: [], popped: [], loopsStarted: [], loopsEnded: [], loopIters: [], logs: [], cases: [],
});

function headerLoc(loc: Loc): Loc {
  return { line: loc.line, col: loc.col, endLine: loc.line, endCol: Math.max(loc.col + 1, 10_000), start: loc.start, end: loc.start };
}

export class TimelineBuilder {
  readonly tl: Timeline;
  private heap = IMap<number, HeapObj>();
  private frames: List<FrameSnap>;
  private readonly frameIndex = new Map<number, number>();
  private detached = IMap<number, FrameSnap>();
  private readonly suspended = new Map<number, FrameSnap>();
  private readonly loopOwner = new Map<number, number>();
  private readonly paramBids = new Map<number, number[]>();
  private readonly closureFns = new Set<number>();
  private readonly touchedKeys = new Set<string>();
  private diff: StepDiff = emptyDiff();

  constructor(meta: ProgramMeta) {
    this.tl = {
      meta, steps: [], snapshots: [], diffs: [], calls: new Map(), loops: new Map(), logs: [], strings: new Map(),
      errors: [], status: 'running', touches: [],
    };
    for (const fn of meta.fns) {
      if (fn.lexParent !== null) this.closureFns.add(fn.lexParent);
      const bids = fn.params.map((name) => meta.bindings.find((b) => b.fnId === fn.id && b.kind === 'param' && b.name === name)?.id ?? -1);
      this.paramBids.set(fn.id, bids);
    }
    const main: FrameSnap = {
      callId: 0, fnId: 0, depth: 0, parentId: -1, lexParentId: null, vars: IMap(), loops: List(), nextOrd: 0, stmt: -1, status: 'active',
    };
    this.frames = List([main]);
    this.frameIndex.set(0, 0);
    this.push({ index: 0, kind: 'start', ev: null, callId: 0, depth: 0, sid: -1, inst: 0, line: 0, loc: null, siteLoc: null, loops: [] }, 0);
  }

  append(events: readonly TraceEvent[]): void {
    for (const ev of events) this.apply(ev);
  }

  get nextIndex(): number {
    return this.tl.steps.length;
  }

  // ── frames ──
  private frameAt(callId: number): FrameSnap | undefined {
    const idx = this.frameIndex.get(callId);
    if (idx !== undefined) return this.frames.get(idx);
    return this.detached.get(callId) ?? this.suspended.get(callId);
  }

  private replaceFrame(next: FrameSnap): void {
    const idx = this.frameIndex.get(next.callId);
    if (idx !== undefined) this.frames = this.frames.set(idx, next);
    else if (this.detached.has(next.callId)) this.detached = this.detached.set(next.callId, next);
    else if (this.suspended.has(next.callId)) this.suspended.set(next.callId, next);
  }

  private popFrame(callId: number, threw: boolean): void {
    const idx = this.frameIndex.get(callId);
    if (idx === undefined) {
      this.suspended.delete(callId);
      return;
    }
    while (this.frames.size > idx && this.frames.size > 1) {
      const f = this.frames.last() as FrameSnap;
      this.frames = this.frames.pop();
      this.frameIndex.delete(f.callId);
      this.diff.popped.push(f.callId);
      const node = this.tl.calls.get(f.callId);
      if (node) {
        node.exitStep = this.nextIndex;
        if (f.callId === callId) node.threw = threw;
      }
      if (this.closureFns.has(f.fnId)) this.detached = this.detached.set(f.callId, f);
    }
  }

  private loopSlot(bid: number, frame: FrameSnap): Pick<VarSlot, 'loopInst' | 'iter'> {
    const loopId = this.tl.meta.bindings[bid]?.loopId;
    if (loopId === undefined) return {};
    const loop = frame.loops.findLast((l) => l.loopId === loopId);
    return loop ? { loopInst: loop.inst, iter: loop.iteration } : {};
  }

  private setVar(callId: number, bid: number, value: V, old: V | undefined, isDecl: boolean): void {
    const f = this.frameAt(callId);
    if (!f) return;
    const prev = f.vars.get(bid);
    const slot: VarSlot = { v: value, ord: prev ? prev.ord : f.nextOrd, ...this.loopSlot(bid, f) };
    // a re-declaration in a new loop iteration (or a first assignment) is a fresh binding
    const fresh = !prev || (isDecl && (prev.loopInst !== slot.loopInst || prev.iter !== slot.iter));
    this.replaceFrame({ ...f, vars: f.vars.set(bid, slot), nextOrd: prev ? f.nextOrd : f.nextOrd + 1 });
    const before = isDecl ? prev?.v : (old ?? prev?.v);
    if (fresh) {
      this.diff.vars.push({ callId, bid, value, kind: 'new' });
    } else {
      this.diff.vars.push({ callId, bid, value, kind: sameV(before, value) ? 'same' : 'changed', ...(before !== undefined ? { old: before } : {}) });
    }
  }

  private updateLoop(ref: LoopRef, mutate: (l: LoopSnap) => LoopSnap | null): void {
    const owner = this.loopOwner.get(ref.inst);
    if (owner === undefined) return;
    const f = this.frameAt(owner);
    if (!f) return;
    const idx = f.loops.findLastIndex((l) => l.inst === ref.inst);
    if (idx < 0) return;
    const next = mutate(f.loops.get(idx) as LoopSnap);
    this.replaceFrame({ ...f, loops: next ? f.loops.set(idx, next) : f.loops.delete(idx) });
  }

  // ── events ──
  private apply(ev: TraceEvent): void {
    const tl = this.tl;
    switch (ev.t) {
      case 'str':
        tl.strings.set(ev.id, ev.value);
        return;
      case 'alloc':
        this.heap = this.heap.set(ev.id, fromSerialized(ev.id, ev.data));
        this.diff.heap.push({ id: ev.id, op: 'alloc', path: [] });
        return;
      case 'mutate': {
        const obj = this.heap.get(ev.id);
        if (obj) this.heap = this.heap.set(ev.id, applyMutation(obj, ev));
        const { t: _t, ...change } = ev;
        this.diff.heap.push(change);
        return;
      }
      case 'read':
        this.diff.reads.push(ev);
        return;
      case 'decl':
        this.setVar(ev.callId, ev.bid, ev.value, undefined, true);
        return;
      case 'assign':
        this.setVar(ev.callId, ev.bid, ev.value, ev.old, false);
        return;
      case 'loopStart': {
        const f = this.frameAt(ev.callId);
        if (!f) return;
        this.loopOwner.set(ev.loop.inst, ev.callId);
        this.replaceFrame({ ...f, loops: f.loops.push({ inst: ev.loop.inst, loopId: ev.loop.loopId, iteration: 0 }) });
        tl.loops.set(ev.loop.inst, {
          inst: ev.loop.inst, loopId: ev.loop.loopId, callId: ev.callId, startStep: this.nextIndex, iterations: 0, checkSteps: [],
        });
        this.diff.loopsStarted.push(ev.loop);
        return;
      }
      case 'loopIter':
        // do-while body entry / callback invocation: the iteration starts at the upcoming step
        this.updateLoop(ev.loop, (l) => ({ ...l, iteration: ev.loop.iteration }));
        this.noteIterations(ev.loop);
        tl.loops.get(ev.loop.inst)?.checkSteps.push(this.nextIndex);
        this.diff.loopIters.push(ev.loop);
        return;
      case 'loopEnd': {
        this.updateLoop(ev.loop, () => null);
        const inst = tl.loops.get(ev.loop.inst);
        if (inst) {
          inst.endStep = this.nextIndex;
          inst.iterations = ev.loop.iteration;
        }
        this.diff.loopsEnded.push(ev.loop);
        return;
      }
      case 'case':
        this.diff.cases.push(ev);
        return;
      case 'exit':
        this.popFrame(ev.callId, Boolean(ev.threw));
        return;
      case 'suspend': {
        const idx = this.frameIndex.get(ev.callId);
        if (idx === undefined) return;
        const f = this.frames.get(idx) as FrameSnap;
        this.frames = this.frames.delete(idx);
        this.frameIndex.delete(ev.callId);
        for (const [cid, i] of this.frameIndex) if (i > idx) this.frameIndex.set(cid, i - 1);
        this.suspended.set(ev.callId, f);
        this.diff.popped.push(ev.callId);
        return;
      }
      case 'resume': {
        const f = this.suspended.get(ev.callId);
        if (!f) return;
        this.suspended.delete(ev.callId);
        const parent = this.frameAt(ev.parentId ?? 0);
        this.frames = this.frames.push({ ...f, depth: (parent?.depth ?? 0) + 1, parentId: ev.parentId ?? 0 });
        this.frameIndex.set(ev.callId, this.frames.size - 1);
        this.diff.pushed.push(ev.callId);
        return;
      }
      case 'log':
        tl.logs.push({ step: this.nextIndex, level: ev.level, text: ev.text, args: ev.args });
        this.diff.logs.push(tl.logs.length - 1);
        return;
      default:
        this.step(ev);
    }
  }

  private noteIterations(ref: LoopRef): void {
    const inst = this.tl.loops.get(ref.inst);
    if (inst && ref.iteration > inst.iterations) inst.iterations = ref.iteration;
  }

  private step(ev: StepEvent): void {
    const tl = this.tl;
    const meta = tl.meta;
    const index = this.nextIndex;
    let callId = 0;
    let sid = -1;
    let inst = 0;
    let loc: Loc | null = null;
    let siteLoc: Loc | null = null;
    switch (ev.t) {
      case 'call': {
        const params = this.paramBids.get(ev.fnId) ?? [];
        let vars = IMap<number, VarSlot>();
        params.forEach((bid, i) => {
          if (bid >= 0) vars = vars.set(bid, { v: orElse(ev.args[i], UNDEF), ord: i });
        });
        const frame: FrameSnap = {
          callId: ev.callId, fnId: ev.fnId, depth: ev.depth, parentId: ev.parentId, lexParentId: ev.lexParentId,
          vars, loops: List(), nextOrd: params.length, stmt: -1, status: 'active',
        };
        this.frames = this.frames.push(frame);
        this.frameIndex.set(ev.callId, this.frames.size - 1);
        this.diff.pushed.push(ev.callId);
        params.forEach((bid, i) => {
          if (bid >= 0) this.diff.vars.push({ callId: ev.callId, bid, kind: 'new', value: orElse(ev.args[i], UNDEF) });
        });
        tl.calls.set(ev.callId, {
          callId: ev.callId, parentId: ev.parentId, fnId: ev.fnId, args: ev.args, depth: ev.depth, siteSid: ev.siteSid,
          enterStep: index, children: [],
        });
        tl.calls.get(ev.parentId)?.children.push(ev.callId);
        callId = ev.callId;
        loc = headerLoc(meta.fns[ev.fnId]?.loc ?? { line: 1, col: 0, endLine: 1, endCol: 0, start: 0, end: 0 });
        siteLoc = meta.stmts[ev.siteSid]?.loc ?? null;
        break;
      }
      case 'return': {
        const f = this.frameAt(ev.callId);
        if (f) this.replaceFrame({ ...f, returning: ev.value, status: 'returning' });
        const node = tl.calls.get(ev.callId);
        if (node) {
          node.returnStep = index;
          node.value = ev.value;
        }
        ({ callId, sid, inst } = ev);
        break;
      }
      case 'cond':
      case 'iter':
        if (ev.loop) {
          const ref = ev.loop;
          this.updateLoop(ref, (l) => ({ ...l, iteration: ref.iteration }));
          this.noteIterations(ref);
          tl.loops.get(ref.inst)?.checkSteps.push(index);
        }
        ({ callId, sid, inst } = ev);
        break;
      case 'catch': {
        const bid = meta.stmts[ev.sid]?.declares?.[0];
        if (bid !== undefined) this.setVar(ev.callId, bid, ev.error, undefined, true);
        ({ callId, sid, inst } = ev);
        break;
      }
      case 'stmt':
        ({ callId, sid, inst } = ev);
        break;
      case 'error':
        tl.errors.push({ step: index, name: ev.name, message: ev.message, sid: ev.sid, callId: ev.callId, uncaught: false });
        callId = ev.callId;
        sid = ev.sid;
        break;
      case 'end':
        tl.status = ev.status;
        if (ev.error) tl.endError = ev.error;
        if (ev.status === 'error' && tl.errors.length) tl.errors[tl.errors.length - 1].uncaught = true;
        break;
    }
    if (sid >= 0) {
      loc = meta.stmts[sid]?.loc ?? null;
      const f = this.frameAt(callId);
      if (f && f.stmt !== sid) this.replaceFrame({ ...f, stmt: sid });
    }
    const frame = this.frameAt(callId);
    const record: StepRecord = {
      index, kind: ev.t, ev, callId, depth: frame?.depth ?? 0, sid, inst, line: loc?.line ?? 0, loc, siteLoc,
      loops: frame ? frame.loops.toArray() : [],
    };
    this.push(record, this.touchOf(record));
  }

  private touchOf(r: StepRecord): number {
    let key: string;
    let line: number;
    if (r.kind === 'call' && r.ev?.t === 'call') {
      key = `${r.ev.parentId}:${r.ev.siteInst}`;
      line = r.siteLoc?.line ?? 0;
    } else if (r.sid >= 0 && r.kind !== 'error') {
      const kind = this.tl.meta.stmts[r.sid]?.kind;
      if (kind === 'loopUpdate' || kind === 'implicitReturn') return 0;
      key = `${r.callId}:${r.inst}`;
      line = r.line;
    } else {
      return 0;
    }
    if (!line || this.touchedKeys.has(key)) return 0;
    this.touchedKeys.add(key);
    return line;
  }

  private push(record: StepRecord, touch: number): void {
    const tl = this.tl;
    tl.steps.push(record);
    tl.snapshots.push({ step: record.index, heap: this.heap, frames: this.frames, detached: this.detached });
    tl.diffs.push(this.diff);
    tl.touches.push(touch);
    this.diff = emptyDiff();
  }
}

export function buildTimeline(meta: ProgramMeta, events: readonly TraceEvent[]): Timeline {
  const b = new TimelineBuilder(meta);
  b.append(events);
  return b.tl;
}
