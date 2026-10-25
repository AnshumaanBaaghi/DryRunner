/** Folded, random-access view of a trace: one persistent snapshot per step. */
import type { List, Map as IMap } from 'immutable';
import type { Loc, ProgramMeta } from '../types/meta';
import type { CaseEvent, EndStatus, LoopRef, MutOp, ReadEvent, StepEvent } from '../types/trace';
import type { HeapKind, ObjId, V } from '../types/values';

export interface PropSlot {
  v: V;
  ord: number;
}
export interface EntrySlot {
  k: V;
  v: V;
  ord: number;
}

export interface HeapObj {
  id: ObjId;
  kind: HeapKind;
  cls?: string;
  /** arrays / typed arrays (holes are `{ hole: 1 }`) */
  elems?: List<V>;
  /** declared length when elements were truncated by the runtime budget */
  length?: number;
  /** plain objects / class instances: key → slot (render order: integer keys first, then `ord`) */
  props?: IMap<string, PropSlot>;
  /** Map entries / Set values keyed by a canonical key string; `ord` keeps insertion order */
  entries?: IMap<string, EntrySlot>;
  text?: string;
  nextOrd: number;
}

export interface VarSlot {
  v: V;
  ord: number;
  /** loop instance + iteration current when declared (block scoping per iteration) */
  loopInst?: number;
  iter?: number;
}

export interface LoopSnap {
  inst: number;
  loopId: number;
  iteration: number;
}

export interface FrameSnap {
  callId: number;
  fnId: number;
  depth: number;
  parentId: number;
  lexParentId: number | null;
  vars: IMap<number, VarSlot>;
  loops: List<LoopSnap>;
  nextOrd: number;
  /** last statement executed in this frame (call site for frames below the top) */
  stmt: number;
  returning?: V;
  status: 'active' | 'returning' | 'threw';
}

export interface Snapshot {
  step: number;
  heap: IMap<ObjId, HeapObj>;
  frames: List<FrameSnap>;
  /** exited frames that closures may still reference (by callId) */
  detached: IMap<number, FrameSnap>;
}

export interface VarChange {
  callId: number;
  bid: number;
  kind: 'new' | 'changed' | 'same';
  old?: V;
  value: V;
}

export interface HeapChange {
  id: ObjId;
  op: MutOp | 'alloc';
  path: (string | number)[];
  key?: V;
  old?: V;
  value?: V;
  args?: V[];
  removed?: V[];
  perm?: number[];
  after?: V[];
  length?: number;
}

export interface StepDiff {
  vars: VarChange[];
  heap: HeapChange[];
  reads: ReadEvent[];
  pushed: number[];
  popped: number[];
  loopsStarted: LoopRef[];
  loopsEnded: LoopRef[];
  loopIters: LoopRef[];
  logs: number[];
  cases: CaseEvent[];
}

export type StepKind = StepEvent['t'] | 'start';

export interface StepRecord {
  index: number;
  kind: StepKind;
  ev: StepEvent | null;
  /** frame the step belongs to (for `call`: the entered frame) */
  callId: number;
  depth: number;
  sid: number;
  inst: number;
  line: number;
  loc: Loc | null;
  /** caller statement for call steps */
  siteLoc: Loc | null;
  loops: LoopSnap[];
}

export interface CallNode {
  callId: number;
  parentId: number;
  fnId: number;
  args: V[];
  depth: number;
  siteSid: number;
  enterStep: number;
  returnStep?: number;
  exitStep?: number;
  value?: V;
  threw?: boolean;
  children: number[];
}

export interface LoopInstance {
  inst: number;
  loopId: number;
  callId: number;
  startStep: number;
  endStep?: number;
  iterations: number;
  /** steps that check/advance this loop (cond + iter steps) */
  checkSteps: number[];
}

export interface LogEntry {
  step: number;
  level: string;
  text: string;
  args: V[];
}

export interface TimelineError {
  step: number;
  name: string;
  message: string;
  sid: number;
  callId: number;
  uncaught: boolean;
}

export interface Timeline {
  meta: ProgramMeta;
  steps: StepRecord[];
  snapshots: Snapshot[];
  diffs: StepDiff[];
  calls: Map<number, CallNode>;
  loops: Map<number, LoopInstance>;
  logs: LogEntry[];
  strings: Map<number, string>;
  errors: TimelineError[];
  status: EndStatus | 'running';
  endError?: { name: string; message: string };
  /** step index → line this step "first touches" (breakpoints / run to line), 0 when none */
  touches: number[];
}
