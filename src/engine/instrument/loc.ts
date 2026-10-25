import type { CompileError, Loc } from '../types/meta';
import type { Node } from './babel';

export function locOf(node: Node): Loc {
  const l = node.loc;
  return {
    line: l?.start.line ?? 1,
    col: l?.start.column ?? 0,
    endLine: l?.end.line ?? 1,
    endCol: l?.end.column ?? 0,
    start: node.start ?? 0,
    end: node.end ?? 0,
  };
}

/** Thrown inside the instrumenter for code we refuse to run; converted to a CompileError result. */
export class InstrumentError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, node?: Node | null) {
    super(message);
    this.line = node?.loc?.start.line ?? 1;
    this.col = node?.loc?.start.column ?? 0;
  }
  toCompileError(): CompileError {
    return { message: this.message, line: this.line, col: this.col };
  }
}
