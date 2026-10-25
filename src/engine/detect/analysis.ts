/**
 * One pass over a finished timeline collecting the facts detectors need: how each variable's values
 * evolve (integer pointers: increasing / decreasing / jumping), what happens to each heap object
 * (pushes, pops, shifts, swaps, reads), and which variables index which arrays (static analysis).
 */
import type { HeapKind, ObjId, V } from '../types/values';
import type { Timeline } from '../timeline/types';
import { refId } from '../timeline/values';
import { varKey, type VarRef } from './track';

export type ValueKind = 'int' | 'number' | 'string' | 'bool' | 'null' | 'undefined' | 'ref' | 'fn' | 'other';

export interface VarInfo {
  ref: VarRef;
  kinds: Set<ValueKind>;
  assigns: number;
  /** integer evolution across assignments within the same frame */
  incs: number;
  decs: number;
  maxJump: number;
  min: number;
  max: number;
  heapIds: Set<ObjId>;
  firstStep: number;
}

export interface ObjInfo {
  id: ObjId;
  kind: HeapKind;
  cls?: string;
  ops: Record<string, number>;
  /** steps with two index writes that exchanged values */
  swaps: number;
  reads: number;
  readSteps: number;
  allocStep: number;
  maxLen: number;
  numeric: boolean;
  /** elements are references to other arrays (2D tables) */
  nested: boolean;
  maxAbs: number;
  varKeys: Set<string>;
}

export interface TraceAnalysis {
  vars: Map<string, VarInfo>;
  objects: Map<ObjId, ObjInfo>;
  /** array variable key → index variable names used as `arr[idx]` / `arr[idx ± k]` in the same function */
  indexedBy: Map<string, Set<string>>;
  recursiveFns: Set<number>;
}

function kindOf(v: V): ValueKind {
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if ('u' in v) return 'undefined';
  if ('r' in v) return 'ref';
  if ('s' in v) return 'string';
  if ('fn' in v) return 'fn';
  if ('n' in v) return 'number';
  return 'other';
}

export function bindingRef(tl: Timeline, bid: number): VarRef {
  const b = tl.meta.bindings[bid];
  const bids = tl.meta.bindings.filter((x) => x.name === b.name && x.fnId === b.fnId).map((x) => x.id);
  return { name: b.name, fnId: b.fnId, bids };
}

function emptyObj(id: ObjId, kind: HeapKind, allocStep: number): ObjInfo {
  return {
    id, kind, ops: {}, swaps: 0, reads: 0, readSteps: 0, allocStep, maxLen: 0, numeric: true, nested: false, maxAbs: 0, varKeys: new Set(),
  };
}

export function analyzeTrace(tl: Timeline): TraceAnalysis {
  const vars = new Map<string, VarInfo>();
  const objects = new Map<ObjId, ObjInfo>();
  const lastInt = new Map<string, number>(); // `${callId}:${bid}` → last integer value
  const refCache = new Map<number, VarRef>();
  const refOf = (bid: number) => {
    let r = refCache.get(bid);
    if (!r) {
      r = bindingRef(tl, bid);
      refCache.set(bid, r);
    }
    return r;
  };
  const noteElems = (info: ObjInfo, elems: V[] | undefined) => {
    if (!elems) return;
    info.maxLen = Math.max(info.maxLen, elems.length);
    for (const e of elems) {
      if (typeof e === 'number') info.maxAbs = Math.max(info.maxAbs, Math.abs(e));
      else if (refId(e) !== null) {
        info.nested = true;
        info.numeric = false;
      } else if (!(typeof e === 'object' && e !== null && ('hole' in e || 'n' in e))) info.numeric = false;
    }
  };

  for (let i = 0; i < tl.diffs.length; i++) {
    const d = tl.diffs[i];
    for (const c of d.vars) {
      const ref = refOf(c.bid);
      const key = varKey(ref);
      let info = vars.get(key);
      if (!info) {
        info = { ref, kinds: new Set(), assigns: 0, incs: 0, decs: 0, maxJump: 0, min: Infinity, max: -Infinity, heapIds: new Set(), firstStep: i };
        vars.set(key, info);
      }
      info.assigns += 1;
      const k = kindOf(c.value);
      info.kinds.add(k);
      const id = refId(c.value);
      if (id !== null) {
        info.heapIds.add(id);
        objects.get(id)?.varKeys.add(key);
      }
      if (k === 'int') {
        const v = c.value as number;
        info.min = Math.min(info.min, v);
        info.max = Math.max(info.max, v);
        const lk = `${c.callId}:${c.bid}`;
        const prev = lastInt.get(lk);
        if (prev !== undefined && c.kind !== 'new') {
          if (v > prev) info.incs += 1;
          if (v < prev) info.decs += 1;
          info.maxJump = Math.max(info.maxJump, Math.abs(v - prev));
        }
        lastInt.set(lk, v);
      }
    }
    const setsThisStep = new Map<ObjId, { idx: number; old?: V; value?: V }[]>();
    for (const h of d.heap) {
      if (h.op === 'alloc') {
        const obj = tl.snapshots[i].heap.get(h.id);
        const info = emptyObj(h.id, obj?.kind ?? 'object', i);
        if (obj?.cls) info.cls = obj.cls;
        noteElems(info, obj?.elems?.toArray());
        objects.set(h.id, info);
        continue;
      }
      const info = objects.get(h.id);
      if (!info) continue;
      info.ops[h.op] = (info.ops[h.op] ?? 0) + 1;
      noteElems(info, h.args);
      if (h.value !== undefined) noteElems(info, [h.value]);
      if (h.op === 'set' && typeof h.path[0] === 'number') {
        const list = setsThisStep.get(h.id) ?? [];
        list.push({ idx: h.path[0], old: h.old, value: h.value });
        setsThisStep.set(h.id, list);
      }
      if (h.op === 'push' || h.op === 'unshift' || h.op === 'splice') {
        const obj = tl.snapshots[i].heap.get(h.id);
        info.maxLen = Math.max(info.maxLen, obj?.elems?.size ?? 0);
      }
    }
    for (const [id, sets] of setsThisStep) {
      if (sets.length < 2) continue;
      for (let a = 0; a < sets.length; a++) {
        for (let b = a + 1; b < sets.length; b++) {
          if (sets[a].idx !== sets[b].idx && JSON.stringify(sets[a].old) === JSON.stringify(sets[b].value) &&
            JSON.stringify(sets[b].old) === JSON.stringify(sets[a].value)) {
            const info = objects.get(id);
            if (info) info.swaps += 1;
          }
        }
      }
    }
    const readIds = new Set<ObjId>();
    for (const r of d.reads) {
      const info = objects.get(r.id);
      if (!info) continue;
      info.reads += 1;
      readIds.add(r.id);
    }
    for (const id of readIds) {
      const info = objects.get(id);
      if (info) info.readSteps += 1;
    }
  }
  // the variables that referenced each object (allocated after the variable first appeared)
  for (const [key, info] of vars) for (const id of info.heapIds) objects.get(id)?.varKeys.add(key);

  const indexedBy = new Map<string, Set<string>>();
  for (const u of tl.meta.analysis.indexUsage) {
    const key = varKey({ name: u.object, fnId: u.fnId });
    const set = indexedBy.get(key) ?? new Set<string>();
    set.add(u.index);
    indexedBy.set(key, set);
  }

  const recursiveFns = new Set<number>();
  for (const node of tl.calls.values()) {
    let p = tl.calls.get(node.parentId);
    while (p) {
      if (p.fnId === node.fnId) {
        recursiveFns.add(node.fnId);
        break;
      }
      p = tl.calls.get(p.parentId);
    }
  }
  return { vars, objects, indexedBy, recursiveFns };
}

/** Variable key in the function owning `name` that is visible where `arrayKey` is used (same fn first, then globals). */
export function resolveVarKey(a: TraceAnalysis, name: string, fnId: number): string | null {
  const own = varKey({ name, fnId });
  if (a.vars.has(own)) return own;
  const global = varKey({ name, fnId: 0 });
  return a.vars.has(global) ? global : null;
}
