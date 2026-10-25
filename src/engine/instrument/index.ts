/** Public entry: source code → instrumented code + static program metadata (or a friendly compile error). */
import type { CompileError, ProgramMeta } from '../types/meta';
import { analyze } from './analyze';
import { generate, parser, t } from './babel';
import { InstrumentError } from './loc';
import { Transformer } from './transformer';

export { TRACER } from './names';

export interface InstrumentOk {
  ok: true;
  code: string;
  meta: ProgramMeta;
}

export interface InstrumentFail {
  ok: false;
  error: CompileError;
}

export type InstrumentResult = InstrumentOk | InstrumentFail;

export const MAX_SOURCE_LENGTH = 200_000;

function parseError(err: unknown): CompileError {
  const e = err as { message?: string; loc?: { line: number; column: number } };
  const message = (e.message ?? 'Syntax error').replace(/\s*\(\d+:\d+\)\s*$/, '');
  return { message, line: e.loc?.line ?? 1, col: e.loc?.column ?? 0 };
}

export function instrument(source: string): InstrumentResult {
  if (source.length > MAX_SOURCE_LENGTH) {
    return { ok: false, error: { message: `Code is too long (max ${MAX_SOURCE_LENGTH.toLocaleString()} characters).`, line: 1, col: 0 } };
  }
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'script', errorRecovery: false });
  } catch (err) {
    return { ok: false, error: parseError(err) };
  }
  try {
    const a = analyze(ast);
    const tr = new Transformer(a, ast.program);
    const body = tr.program(ast.program);
    const program = t.program(body, ast.program.directives);
    const code = generate(program, { comments: false }).code;
    return {
      ok: true,
      code,
      meta: {
        source, stmts: tr.stmts, exprs: tr.exprs, fns: a.fns, loops: a.loops, bindings: a.bindings, analysis: a.analysis,
      },
    };
  } catch (err) {
    if (err instanceof InstrumentError) return { ok: false, error: err.toCompileError() };
    throw err;
  }
}
