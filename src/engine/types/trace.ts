/** Runtime trace events. Step-creating events end a step; every other event folds forward into the next step. */
import type { ObjId, SerializedObj, StrId, V } from './values';

export type Sub = [exprId: number, value: V];

export interface LoopRef {
  loopId: number;
  inst: number;
  iteration: number;
}

export type MutOp =
  | 'set'
  | 'delete'
  | 'length'
  | 'push'
  | 'pop'
  | 'shift'
  | 'unshift'
  | 'splice'
  | 'sort'
  | 'reverse'
  | 'fill'
  | 'copyWithin'
  | 'mapSet'
  | 'mapDelete'
  | 'mapClear'
  | 'setAdd'
  | 'setDelete'
  | 'setClear';

export type EndStatus = 'ok' | 'error' | 'limit-steps' | 'limit-depth' | 'timeout';

// ── step-creating ──
export interface StmtEvent {
  t: 'stmt';
  sid: number;
  callId: number;
  inst: number;
  sub?: Sub[];
}
export interface CondEvent {
  t: 'cond';
  sid: number;
  callId: number;
  inst: number;
  kind: 'if' | 'loop' | 'switch';
  value: V;
  result: boolean;
  sub?: Sub[];
  loop?: LoopRef;
}
export interface CallEvent {
  t: 'call';
  callId: number;
  parentId: number;
  lexParentId: number | null;
  fnId: number;
  args: V[];
  depth: number;
  siteSid: number;
  siteInst: number;
}
export interface ReturnEvent {
  t: 'return';
  callId: number;
  sid: number;
  inst: number;
  value: V;
  implicit: boolean;
  sub?: Sub[];
}
export interface IterEvent {
  t: 'iter';
  sid: number;
  callId: number;
  inst: number;
  loop: LoopRef;
  bindings: V[];
  sub?: Sub[];
}
export interface CatchEvent {
  t: 'catch';
  sid: number;
  callId: number;
  inst: number;
  error: V;
}
export interface ErrorEvent {
  t: 'error';
  name: string;
  message: string;
  sid: number;
  callId: number;
  fromThrow: boolean;
}
export interface EndEvent {
  t: 'end';
  status: EndStatus;
  error?: { name: string; message: string };
}

// ── fold-forward ──
export interface DeclEvent {
  t: 'decl';
  bid: number;
  callId: number;
  value: V;
}
export interface AssignEvent {
  t: 'assign';
  bid: number;
  callId: number;
  old?: V;
  value: V;
}
export interface MutateEvent {
  t: 'mutate';
  id: ObjId;
  op: MutOp;
  path: (string | number)[];
  /** Map/Set entry key (any value) for mapSet/mapDelete/setAdd/setDelete. */
  key?: V;
  old?: V;
  value?: V;
  args?: V[];
  removed?: V[];
  after?: V[];
  perm?: number[];
  length?: number;
}
export interface AllocEvent {
  t: 'alloc';
  id: ObjId;
  data: SerializedObj;
}
export interface ReadEvent {
  t: 'read';
  id: ObjId;
  path: (string | number)[];
  /** Map/Set lookup key; `op` distinguishes get/has. */
  key?: V;
  op?: 'get' | 'has';
  value: V;
}
export interface LogEvent {
  t: 'log';
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: V[];
  text: string;
}
export interface LoopStartEvent {
  t: 'loopStart';
  loop: LoopRef;
  callId: number;
}
export interface LoopIterEvent {
  t: 'loopIter';
  loop: LoopRef;
}
export interface LoopEndEvent {
  t: 'loopEnd';
  loop: LoopRef;
}
export interface CaseEvent {
  t: 'case';
  sid: number;
  index: number;
  fallthrough: boolean;
}
export interface FrameEvent {
  t: 'exit' | 'suspend' | 'resume';
  callId: number;
  parentId?: number;
  threw?: boolean;
}
export interface StrEvent {
  t: 'str';
  id: StrId;
  value: string;
}

export type StepEvent = StmtEvent | CondEvent | CallEvent | ReturnEvent | IterEvent | CatchEvent | ErrorEvent | EndEvent;
export type SubEvent =
  | DeclEvent
  | AssignEvent
  | MutateEvent
  | AllocEvent
  | ReadEvent
  | LogEvent
  | LoopStartEvent
  | LoopIterEvent
  | LoopEndEvent
  | CaseEvent
  | FrameEvent
  | StrEvent;
export type TraceEvent = StepEvent | SubEvent;

const STEP_TYPES = new Set(['stmt', 'cond', 'call', 'return', 'iter', 'catch', 'error', 'end']);

export function isStepEvent(ev: TraceEvent): ev is StepEvent {
  return STEP_TYPES.has(ev.t);
}

export interface RunLimits {
  maxSteps: number;
  maxDepth: number;
  timeoutMs: number;
  seed: number;
}

export const DEFAULT_LIMITS: RunLimits = { maxSteps: 20_000, maxDepth: 1_000, timeoutMs: 3_000, seed: 42 };
