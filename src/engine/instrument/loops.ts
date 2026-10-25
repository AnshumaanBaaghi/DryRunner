/**
 * Loops: `{ const L = __as_t.ls(id, kind, frame); try { <loop> } finally { __as_t.le(L) } }`.
 * Iteration k of for/while starts at the k-th passing check (`lt`); do-while at body entry (`li`);
 * for-of/in at element production (`ib`). Labels stay directly on the loop.
 */
import type { LoopKind } from '../types/meta';
import { t, type BabelTypes, type Expression, type Statement } from './babel';
import { arr, hook, hookStmt, id, loopName, num } from './hooks';
import { declarator, transformPattern } from './patterns';
import type { Transformer } from './transformer';

export const LOOP_KIND_CODE: Record<Exclude<LoopKind, 'callback'>, number> = {
  for: 0, while: 1, doWhile: 2, forOf: 3, forIn: 4,
};

type DeclId = BabelTypes.VariableDeclarator['id'];

type LoopNode = BabelTypes.ForStatement | BabelTypes.WhileStatement | BabelTypes.DoWhileStatement |
  BabelTypes.ForOfStatement | BabelTypes.ForInStatement;

function kindOf(node: LoopNode): Exclude<LoopKind, 'callback'> {
  switch (node.type) {
    case 'ForStatement': return 'for';
    case 'WhileStatement': return 'while';
    case 'DoWhileStatement': return 'doWhile';
    case 'ForOfStatement': return 'forOf';
    default: return 'forIn';
  }
}

/** Source range covering the loop header (`for (…)`), used when there is no test expression. */
function headerNode(node: LoopNode): BabelTypes.Node {
  const end = node.body.start ?? node.end ?? 0;
  return { ...node, end, loc: node.loc ? { ...node.loc, end: node.body.loc?.start ?? node.loc.end } : node.loc } as BabelTypes.Node;
}

function test(tr: Transformer, L: string, loopId: number, node: BabelTypes.Expression | null | undefined, fallback: LoopNode): Expression {
  const sid = tr.addStmt('loopTest', node ?? headerNode(fallback), { loopId });
  const value = node ? tr.withStep(sid, () => tr.expr(node)) : t.booleanLiteral(true);
  return hook('lt', [id(L), hook('s', [num(sid)]), value]);
}

function forStatement(tr: Transformer, node: BabelTypes.ForStatement, L: string, loopId: number): Statement {
  let init: BabelTypes.VariableDeclaration | Expression | null = null;
  if (t.isVariableDeclaration(node.init)) {
    const decl = node.init;
    const declared = tr.declaredBindings(decl);
    const sid = tr.addStmt('loopInit', decl, { declares: declared.map((d) => d.bid), loopId });
    const declarators = tr.withStep(sid, () => decl.declarations.flatMap((d) => declarator(tr, d)));
    init = t.variableDeclaration(decl.kind as 'var' | 'let' | 'const', [
      t.variableDeclarator(id(tr.uid('i')), hook('s', [num(sid)])),
      ...declarators,
      t.variableDeclarator(id(tr.uid('i')),
        hook('d', [num(sid), arr(declared.map((d) => num(d.bid))), arr(declared.map((d) => id(d.name)))])),
    ]);
  } else if (node.init) {
    const sid = tr.addStmt('loopInit', node.init, { loopId });
    init = hook('e', [hook('s', [num(sid)]), tr.withStep(sid, () => tr.expr(node.init as Expression))]);
  }
  let update: Expression | null = null;
  if (node.update) {
    const sid = tr.addStmt('loopUpdate', node.update, { loopId });
    update = hook('e', [hook('s', [num(sid)]), tr.withStep(sid, () => tr.expr(node.update as Expression))]);
  }
  const testExpr = test(tr, L, loopId, node.test, node);
  return t.forStatement(init, testExpr, update, tr.asBlock(node.body));
}

function forEachHead(tr: Transformer, node: BabelTypes.ForOfStatement | BabelTypes.ForInStatement, L: string, loopId: number): Statement {
  const left = node.left;
  const declared = t.isVariableDeclaration(left) ? tr.declaredBindings(left) : [];
  const sid = tr.addStmt(t.isForOfStatement(node) ? 'forOf' : 'forIn', left, { declares: declared.map((d) => d.bid), loopId });
  let leftT: BabelTypes.VariableDeclaration | BabelTypes.LVal;
  let values: { bid: number; name: string }[] = declared;
  if (t.isVariableDeclaration(left)) {
    leftT = t.variableDeclaration(left.kind as 'var' | 'let' | 'const',
      left.declarations.map((d) => t.variableDeclarator(tr.withoutStep(() => transformPattern(tr, d.id as BabelTypes.LVal)) as DeclId)));
  } else {
    leftT = tr.withoutStep(() => transformPattern(tr, left as BabelTypes.LVal)) as BabelTypes.LVal;
    values = tr.declaredBindings(left);
  }
  const body = tr.asBlock(node.body);
  body.body.unshift(hookStmt('ib', [id(L), num(sid), arr(values.map((d) => num(d.bid))), arr(values.map((d) => id(d.name)))]));
  if (t.isForOfStatement(node)) {
    const right = hook('fo', [id(L), hook('s', [num(sid)]), tr.withStep(sid, () => tr.expr(node.right))]);
    return t.forOfStatement(leftT, right, body);
  }
  return t.forInStatement(leftT, tr.exprNoStep(node.right), body);
}

export function transformLoop(tr: Transformer, node: LoopNode, label: BabelTypes.Identifier | null): Statement[] {
  const loopId = tr.a.loopIdOf.get(node) ?? -1;
  const L = loopName(loopId);
  const kind = kindOf(node);
  let inner: Statement;
  switch (node.type) {
    case 'ForStatement':
      inner = forStatement(tr, node, L, loopId);
      break;
    case 'WhileStatement':
      inner = t.whileStatement(test(tr, L, loopId, node.test, node), tr.asBlock(node.body));
      break;
    case 'DoWhileStatement': {
      const body = tr.asBlock(node.body);
      body.body.unshift(hookStmt('li', [id(L)]));
      inner = t.doWhileStatement(test(tr, L, loopId, node.test, node), body);
      break;
    }
    default:
      inner = forEachHead(tr, node, L, loopId);
  }
  const loopStmt = label ? t.labeledStatement(id(label.name), inner) : inner;
  return [t.blockStatement([
    t.variableDeclaration('const', [t.variableDeclarator(id(L), hook('ls', [num(loopId), num(LOOP_KIND_CODE[kind]), id(tr.fn.handle)]))]),
    t.tryStatement(t.blockStatement([loopStmt]), null, t.blockStatement([hookStmt('le', [id(L)])])),
  ])];
}
