/**
 * Functions get a frame handle linked to their lexical parent:
 *   let <temps>; const __as_cN = __as_t.enter(N, __as_cParent, [params]);
 *   try { …body…; __as_t.ir(__as_cN, endSid) } catch (e) { __as_t.thrown(__as_cN, e); throw e } finally { __as_t.exit(__as_cN) }
 * Constructors replace `this` with a tracked `__as_self`; derived constructors bind it right after `super()`.
 */
import { t, type BabelTypes, type Expression, type FunctionNode, type Node, type Statement } from './babel';
import { handleName, hook, hookStmt, id, num, SELF, undef } from './hooks';
import { transformPattern } from './patterns';
import type { FnCtx, Transformer } from './transformer';

function endNode(node: Node): Node {
  const end = node.loc?.end ?? { line: 1, column: 0, index: 0 };
  const startCol = Math.max(0, end.column - 1);
  return {
    type: 'Noop',
    start: Math.max(0, (node.end ?? 1) - 1),
    end: node.end ?? 0,
    loc: { start: { line: end.line, column: startCol, index: 0 }, end, filename: '', identifierName: undefined },
  } as unknown as Node;
}

/** Nearest enclosing frame handle that exists at this lexical position (param scopes have none yet). */
function lexicalHandle(tr: Transformer, ctx: FnCtx | null): Expression {
  let c = ctx;
  while (c && tr.paramScope.has(c.fnId)) c = c.parent;
  return c ? id(c.handle) : t.nullLiteral();
}

function paramPattern(tr: Transformer, p: BabelTypes.Function['params'][number], restNames: string[]): BabelTypes.Function['params'][number] {
  if (t.isRestElement(p) && t.isIdentifier(p.argument)) {
    restNames.push(p.argument.name);
    return t.restElement(id(p.argument.name));
  }
  if (t.isIdentifier(p)) return id(p.name);
  if (t.isTSParameterProperty(p)) return p;
  return transformPattern(tr, p as BabelTypes.LVal) as BabelTypes.Function['params'][number];
}

export function transformFunction<F extends FunctionNode>(tr: Transformer, node: F, opts: { derivedCtor?: boolean } = {}): F {
  const fnId = tr.a.fnIdOf.get(node);
  if (fnId === undefined) return node;
  const isArrow = t.isArrowFunctionExpression(node);
  const isCtor = t.isClassMethod(node) && node.kind === 'constructor';
  const parent = tr.fn;
  const ctx: FnCtx = {
    fnId, handle: handleName(fnId), temps: [], parent,
    thisOwner: parent.thisOwner, selfName: isCtor ? SELF : null, derivedCtor: Boolean(opts.derivedCtor) && isCtor,
    thisProxy: false,
  };
  if (!isArrow) ctx.thisOwner = ctx;

  const savedStep = tr.stepSid;
  const savedInParams = tr.inParams;
  tr.fn = ctx;
  tr.stepSid = null;
  try {
    // parameters: defaults run before the body declares the handle → no assignment hooks there
    tr.inParams = true;
    tr.paramScope.add(fnId);
    const restNames: string[] = [];
    node.params = node.params.map((p) => paramPattern(tr, p, restNames)) as F['params'];
    tr.paramScope.delete(fnId);
    tr.inParams = false;
    const paramIds = node.params.flatMap((p) => Object.keys(t.getBindingIdentifiers(p as Node)));

    let directives: BabelTypes.Directive[] = [];
    let body: Statement[];
    if (t.isBlockStatement(node.body)) {
      directives = node.body.directives;
      body = tr.block(node.body.body);
    } else {
      const expr = node.body as Expression;
      const sid = tr.addStmt('return', expr);
      const value = tr.withStep(sid, () => tr.expr(expr));
      body = [t.returnStatement(hook('ret', [hook('s', [num(sid)]), id(ctx.handle), value]))];
    }
    const endSid = tr.addStmt('implicitReturn', endNode(node));

    const prologue: Statement[] = [];
    if (ctx.temps.length) prologue.push(t.variableDeclaration('let', ctx.temps.map((n) => t.variableDeclarator(id(n)))));
    for (const r of restNames) prologue.push(t.expressionStatement(t.assignmentExpression('=', id(r), hook('o', [id(r)]))));
    if (ctx.derivedCtor) prologue.push(t.variableDeclaration('let', [t.variableDeclarator(id(SELF))]));
    prologue.push(t.variableDeclaration('const', [t.variableDeclarator(id(ctx.handle),
      hook('enter', [num(fnId), lexicalHandle(tr, parent), t.arrayExpression(paramIds.map((n) => id(n)))]))]));
    if (isCtor && !ctx.derivedCtor) {
      prologue.push(t.variableDeclaration('const', [t.variableDeclarator(id(SELF), hook('self', [id(ctx.handle), t.thisExpression()]))]));
    }
    const err = tr.uid('e');
    const tryStmt = t.tryStatement(
      t.blockStatement([...body, hookStmt('ir', [id(ctx.handle), num(endSid), isCtor ? id(SELF) : undef()])]),
      t.catchClause(id(err), t.blockStatement([hookStmt('thrown', [id(ctx.handle), id(err)]), t.throwStatement(id(err))])),
      t.blockStatement([hookStmt('exit', [id(ctx.handle)])]),
    );
    node.body = t.blockStatement([...prologue, tryStmt], directives) as F['body'];
    if (t.isArrowFunctionExpression(node)) node.expression = false;
  } finally {
    tr.fn = parent;
    tr.stepSid = savedStep;
    tr.inParams = savedInParams;
  }
  return node;
}

/**
 * Class field initializers run with `this` = the instance before any constructor body: their `this`
 * becomes `__as_t.p(this)` (the tracked proxy) so arrow-function fields mutate through the membrane.
 */
function withFieldContext<R>(tr: Transformer, f: () => R): R {
  const saved = tr.fn;
  const barrier: FnCtx = { ...saved, selfName: null, derivedCtor: false, thisProxy: true };
  barrier.thisOwner = barrier;
  tr.fn = barrier;
  try {
    return tr.withoutStep(f);
  } finally {
    tr.fn = saved;
  }
}

export function transformClass<C extends BabelTypes.Class>(tr: Transformer, node: C): C {
  const derived = Boolean(node.superClass);
  if (node.superClass) node.superClass = tr.exprNoStep(node.superClass);
  node.body.body = node.body.body.map((member) => {
    if (t.isClassMethod(member) || t.isClassPrivateMethod(member)) {
      if (t.isClassMethod(member) && member.computed) member.key = tr.exprNoStep(member.key as Expression);
      return transformFunction(tr, member, { derivedCtor: derived });
    }
    if (t.isClassProperty(member) || t.isClassPrivateProperty(member) || t.isClassAccessorProperty(member)) {
      if (t.isClassProperty(member) && member.computed) member.key = tr.exprNoStep(member.key as Expression);
      if (member.value) {
        const value = member.value;
        member.value = member.static ? tr.exprNoStep(value) : withFieldContext(tr, () => tr.expr(value));
      }
      return member;
    }
    if (t.isStaticBlock(member)) {
      member.body = tr.withoutStep(() => tr.block(member.body));
      return member;
    }
    return member;
  }) as C['body']['body'];
  return node;
}
