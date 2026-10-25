/** Runtime frame / loop records kept by the Tracer, plus shared sentinels and helpers. */
import type { Sub } from '../types/trace';

/** Sentinel thrown to stop execution (not an Error, so `catch (e) { if (e instanceof Error) … }` ignores it). */
export const ABORT: Readonly<{ algoscopeAbort: true }> = Object.freeze({ algoscopeAbort: true as const });

export const LOOP_FOR = 0;
export const LOOP_WHILE = 1;
export const LOOP_DO = 2;
export const LOOP_FOR_OF = 3;
export const LOOP_FOR_IN = 4;
export const LOOP_CALLBACK = 5;

export interface Frame {
  id: number;
  fnId: number;
  depth: number;
  lex: Frame | null;
  stmt: number;
  inst: number;
  sub: Sub[];
  loops: LoopState[];
  muted: boolean;
  returned: boolean;
  onStack: boolean;
  exited: boolean;
  switchSid: number;
  switchHit: boolean;
}

export interface LoopState {
  inst: number;
  loopId: number;
  kind: number;
  frame: Frame;
  iteration: number;
  pendingSub: Sub[] | null;
  active: boolean;
}

export function newFrame(id: number, fnId: number, depth: number, lex: Frame | null, muted: boolean): Frame {
  return {
    id, fnId, depth, lex, stmt: -1, inst: 0, sub: [], loops: [], muted, returned: false, onStack: true, exited: false,
    switchSid: -1, switchHit: false,
  };
}

export function errorInfo(err: unknown): { name: string; message: string } {
  if (err !== null && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown };
    return { name: typeof e.name === 'string' ? e.name : 'Error', message: typeof e.message === 'string' ? e.message : String(err) };
  }
  return { name: 'Uncaught', message: String(err) };
}
