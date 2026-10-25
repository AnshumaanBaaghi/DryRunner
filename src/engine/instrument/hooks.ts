/** Builders for generated identifiers and `__as_t.<hook>(...)` calls. */
import { t, type Expression, type Identifier, type Statement } from './babel';
import { TRACER } from './names';

export { handleName, loopName, PREFIX, SELF, TRACER } from './names';

export function id(name: string): Identifier {
  return t.identifier(name);
}

export function num(n: number): Expression {
  return t.numericLiteral(n);
}

export function str(s: string): Expression {
  return t.stringLiteral(s);
}

/** `__as_t.name(args…)` */
export function hook(name: string, args: Expression[]): Expression {
  return t.callExpression(t.memberExpression(id(TRACER), id(name)), args);
}

export function hookStmt(name: string, args: Expression[]): Statement {
  return t.expressionStatement(hook(name, args));
}

export function arr(items: Expression[]): Expression {
  return t.arrayExpression(items);
}

export function undef(): Expression {
  return t.unaryExpression('void', num(0), true);
}

/** Fresh identifier node with the same name (never reuse a node in two places). */
export function cloneId(node: Identifier): Identifier {
  return t.identifier(node.name);
}
