/**
 * Expression instrumentation: sub-value capture (`__as_t.v`), object tracking (`__as_t.o`),
 * variable assignment hooks and higher-order iteration calls. Never wraps callees, assignment
 * targets, `typeof ident`/`delete` operands, `super`, or nodes inside an optional-chain spine.
 */
import { HOF_METHODS } from './analyze';
import { t, type BabelTypes, type Expression, type Node } from './babel';
import { hook, id, num, SELF, str, undef } from './hooks';
import { transformClass, transformFunction } from './functions';
import { destructuringTargets, transformPattern } from './patterns';
import type { Transformer } from './transformer';

/** value: normal read · callee/target: reference position · object: base of a member access. */
export type Role = 'value' | 'callee' | 'object' | 'target';

type Arg = BabelTypes.CallExpression['arguments'][number];

export function transformArgs(tr: Transformer, args: Arg[]): (Expression | BabelTypes.SpreadElement)[] {
  return args.map((a) => {
    if (t.isSpreadElement(a)) return t.spreadElement(tr.expr(a.argument));
    if (t.isArgumentPlaceholder(a)) return a as never;
    return tr.expr(a as Expression);
  });
}

function eidOf(e: Expression): number | null {
  if (t.isCallExpression(e) && t.isMemberExpression(e.callee) && t.isIdentifier(e.callee.property) &&
    (e.callee.property.name === 'v' || e.callee.property.name === 'vo') && t.isNumericLiteral(e.arguments[0])) {
    return e.arguments[0].value;
  }
  return null;
}

/** Computed member key: captured as a sub-value and flagged so the HUD can render `dp[i]` as `dp[4]`. */
export function transformKey(tr: Transformer, key: Node): Expression {
  if (t.isPrivateName(key)) return key as never;
  const e = tr.expr(key as Expression);
  const eid = eidOf(e);
  if (eid !== null && tr.exprs[eid]) tr.exprs[eid].role = 'key';
  return e;
}

function thisExpr(tr: Transformer): Expression {
  const owner = tr.fn.thisOwner;
  if (owner.selfName) return id(owner.selfName);
  if (owner.thisProxy) return hook('p', [t.thisExpression()]);
  return t.thisExpression();
}

function identifier(tr: Transformer, node: BabelTypes.Identifier, role: Role): Expression {
  const fresh = id(node.name);
  if (role !== 'value') return fresh;
  const bid = tr.a.bidOf.get(node);
  if (bid === undefined) return fresh; // unbound global (Math, undefined, console…)
  const kind = tr.a.bindings[bid]?.kind;
  if (kind === 'function' || kind === 'class') return fresh;
  return tr.wrapV(node, fresh);
}

export function memberTarget(tr: Transformer, node: BabelTypes.MemberExpression): BabelTypes.MemberExpression {
  const object = t.isSuper(node.object) ? node.object : tr.expr(node.object, 'object');
  const property = node.computed ? transformKey(tr, node.property) : node.property;
  return t.memberExpression(object, property as Expression, node.computed);
}

function member(tr: Transformer, node: BabelTypes.MemberExpression, role: Role): Expression {
  const m = memberTarget(tr, node);
  if (role !== 'value') return m;
  return tr.wrapV(node, m);
}

function chainChild(tr: Transformer, node: Expression, asCallee: boolean): Expression {
  if (t.isOptionalMemberExpression(node) || t.isOptionalCallExpression(node)) return chainSpine(tr, node);
  if (asCallee && t.isMemberExpression(node)) return memberTarget(tr, node);
  return tr.expr(node, 'object');
}

function chainSpine(tr: Transformer, node: BabelTypes.OptionalMemberExpression | BabelTypes.OptionalCallExpression): Expression {
  if (t.isOptionalMemberExpression(node)) {
    const object = chainChild(tr, node.object, false);
    const property = node.computed ? transformKey(tr, node.property) : node.property;
    return t.optionalMemberExpression(object, property as Expression, node.computed, node.optional);
  }
  const callee = chainChild(tr, node.callee, true);
  return t.optionalCallExpression(callee, transformArgs(tr, node.arguments), node.optional);
}

function call(tr: Transformer, node: BabelTypes.CallExpression): Expression {
  const callee = node.callee;
  if (t.isSuper(callee)) {
    const c = t.callExpression(t.super(), transformArgs(tr, node.arguments));
    const owner = tr.fn.thisOwner;
    if (!owner.derivedCtor || !owner.selfName) return c;
    return t.sequenceExpression([c, t.assignmentExpression('=', id(SELF), hook('self', [id(owner.handle), t.thisExpression()]))]);
  }
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property) &&
    HOF_METHODS.has(callee.property.name) && node.arguments.length > 0 && !t.isSuper(callee.object)) {
    const tmp = tr.temp();
    const method = callee.property.name;
    const object = tr.expr(callee.object, 'object');
    const loopId = tr.a.loopIdOf.get(node) ?? -1;
    const sid = tr.stepSid ?? -1;
    const args = transformArgs(tr, node.arguments);
    const seq = t.sequenceExpression([
      t.assignmentExpression('=', id(tmp.name), object),
      hook('hof', [num(loopId), num(sid), id(tmp.name), str(method), t.memberExpression(id(tmp.name), id(method)), t.arrayExpression(args)]),
    ]);
    return tr.wrapVO(node, seq);
  }
  let calleeT: Expression;
  if (t.isMemberExpression(callee)) calleeT = memberTarget(tr, callee);
  else if (t.isIdentifier(callee)) calleeT = id(callee.name);
  else calleeT = tr.expr(callee as Expression, 'callee');
  return tr.wrapVO(node, t.callExpression(calleeT, transformArgs(tr, node.arguments)));
}

function assignment(tr: Transformer, node: BabelTypes.AssignmentExpression): Expression {
  const { operator, left } = node;
  if (t.isIdentifier(left)) {
    const bid = tr.a.bidOf.get(left);
    const right = tr.expr(node.right);
    const h = bid === undefined ? null : tr.handleFor(bid);
    if (bid === undefined || h === null) return t.assignmentExpression(operator, id(left.name), right);
    if (operator === '??=' || operator === '||=' || operator === '&&=') {
      const logical = operator.slice(0, -1) as '??' | '||' | '&&';
      return t.logicalExpression(logical, id(left.name),
        hook('a', [h, num(bid), id(left.name), t.assignmentExpression('=', id(left.name), right)]));
    }
    return hook('a', [h, num(bid), id(left.name), t.assignmentExpression(operator, id(left.name), right)]);
  }
  if (t.isMemberExpression(left)) {
    return t.assignmentExpression(operator, memberTarget(tr, left), tr.expr(node.right));
  }
  if (t.isArrayPattern(left) || t.isObjectPattern(left)) return destructuringAssign(tr, node, left);
  return t.assignmentExpression(operator, left as BabelTypes.LVal, tr.expr(node.right));
}

function destructuringAssign(tr: Transformer, node: BabelTypes.AssignmentExpression,
  left: BabelTypes.ArrayPattern | BabelTypes.ObjectPattern): Expression {
  const literal = t.isArrayExpression(node.right) || t.isObjectExpression(node.right);
  const right = literal ? literalNoTrack(tr, node.right as BabelTypes.ArrayExpression | BabelTypes.ObjectExpression) : tr.expr(node.right);
  const pattern = transformPattern(tr, left) as BabelTypes.LVal;
  const { names, rests } = destructuringTargets(left);
  const tracked = names
    .map((n) => {
      const bid = tr.a.bidOf.get(n);
      const h = bid === undefined ? null : tr.handleFor(bid);
      return h && bid !== undefined ? { n, bid, h } : null;
    })
    .filter((x): x is { n: BabelTypes.Identifier; bid: number; h: Expression } => x !== null);
  if (tracked.length === 0) return t.assignmentExpression('=', pattern, right);
  const olds = tracked.map(() => tr.temp());
  const result = tr.temp();
  const seq: Expression[] = [
    ...tracked.map(({ n }, i) => t.assignmentExpression('=', id(olds[i].name), id(n.name))),
    t.assignmentExpression('=', id(result.name), t.assignmentExpression('=', pattern, right)),
    ...rests.map((n) => t.assignmentExpression('=', id(n.name), hook('o', [id(n.name)]))),
    ...tracked.map(({ n, bid, h }, i) => hook('a', [h, num(bid), id(olds[i].name), id(n.name)])),
    id(result.name),
  ];
  return t.sequenceExpression(seq);
}

/** Array/object literal used only as a destructuring source (e.g. a swap): not tracked. */
export function literalNoTrack(tr: Transformer, node: BabelTypes.ArrayExpression | BabelTypes.ObjectExpression): Expression {
  return t.isArrayExpression(node) ? arrayLiteral(tr, node) : objectLiteral(tr, node);
}

function arrayLiteral(tr: Transformer, node: BabelTypes.ArrayExpression): BabelTypes.ArrayExpression {
  return t.arrayExpression(node.elements.map((el) => {
    if (el === null) return null;
    if (t.isSpreadElement(el)) return t.spreadElement(tr.expr(el.argument));
    return tr.expr(el as Expression);
  }));
}

function objectLiteral(tr: Transformer, node: BabelTypes.ObjectExpression): BabelTypes.ObjectExpression {
  return t.objectExpression(node.properties.map((p) => {
    if (t.isSpreadElement(p)) return t.spreadElement(tr.expr(p.argument));
    if (t.isObjectMethod(p)) {
      if (p.computed) p.key = tr.exprNoStep(p.key as Expression);
      return transformFunction(tr, p);
    }
    const key = p.computed ? tr.expr(p.key as Expression) : p.key;
    const value = tr.expr(p.value as Expression);
    const shorthand = p.shorthand && t.isIdentifier(value) && t.isIdentifier(key) && value.name === key.name;
    return t.objectProperty(key as Expression, value, p.computed, shorthand);
  }));
}

function update(tr: Transformer, node: BabelTypes.UpdateExpression): Expression {
  const arg = node.argument;
  if (t.isIdentifier(arg)) {
    const bid = tr.a.bidOf.get(arg);
    const h = bid === undefined ? null : tr.handleFor(bid);
    if (bid === undefined || h === null) return t.updateExpression(node.operator, id(arg.name), node.prefix);
    return hook('upd', [h, num(bid), id(arg.name), t.updateExpression(node.operator, id(arg.name), true),
      t.booleanLiteral(node.prefix)]);
  }
  if (t.isMemberExpression(arg)) return t.updateExpression(node.operator, memberTarget(tr, arg), node.prefix);
  return node;
}

function unary(tr: Transformer, node: BabelTypes.UnaryExpression): Expression {
  const arg = node.argument;
  if (node.operator === 'typeof' && t.isIdentifier(arg)) {
    return tr.wrapV(node, t.unaryExpression('typeof', id(arg.name), true));
  }
  if (node.operator === 'delete') {
    let target: Expression = arg;
    if (t.isMemberExpression(arg)) target = memberTarget(tr, arg);
    else if (t.isOptionalMemberExpression(arg)) target = chainSpine(tr, arg);
    else if (t.isIdentifier(arg)) target = id(arg.name);
    return tr.wrapV(node, t.unaryExpression('delete', target, true));
  }
  return tr.wrapV(node, t.unaryExpression(node.operator, tr.expr(arg), true));
}

function yieldExpr(tr: Transformer, node: BabelTypes.YieldExpression): Expression {
  const h = id(tr.fn.handle);
  const arg = node.argument ? tr.expr(node.argument) : undef();
  return hook('resume', [h, t.yieldExpression(hook('suspend', [id(tr.fn.handle), arg]), node.delegate)]);
}

export function transformExpression(tr: Transformer, node: Expression, role: Role): Expression {
  switch (node.type) {
    case 'Identifier':
      return identifier(tr, node, role);
    case 'ThisExpression':
      return thisExpr(tr);
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
    case 'RegExpLiteral':
    case 'MetaProperty':
      return node;
    case 'TemplateLiteral':
      return tr.wrapV(node, t.templateLiteral(node.quasis, node.expressions.map((e) => tr.expr(e as Expression))));
    case 'ArrayExpression':
      return tr.track(arrayLiteral(tr, node));
    case 'ObjectExpression':
      return tr.track(objectLiteral(tr, node));
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return transformFunction(tr, node);
    case 'ClassExpression': {
      const cls = transformClass(tr, node);
      return tr.a.privateClasses.has(node) ? hook('np', [cls]) : cls;
    }
    case 'MemberExpression':
      return member(tr, node, role);
    case 'OptionalMemberExpression': {
      const c = chainSpine(tr, node);
      return role === 'value' ? tr.wrapV(node, c) : c;
    }
    case 'OptionalCallExpression':
      return tr.wrapVO(node, chainSpine(tr, node));
    case 'CallExpression':
      return call(tr, node);
    case 'NewExpression': {
      const callee = t.isIdentifier(node.callee) ? id(node.callee.name) : tr.expr(node.callee as Expression, 'callee');
      return tr.wrapVO(node, t.newExpression(callee, transformArgs(tr, node.arguments)));
    }
    case 'AssignmentExpression':
      return assignment(tr, node);
    case 'UpdateExpression':
      return update(tr, node);
    case 'UnaryExpression':
      return unary(tr, node);
    case 'BinaryExpression': {
      const left = t.isPrivateName(node.left) ? node.left : tr.expr(node.left as Expression);
      return tr.wrapV(node, t.binaryExpression(node.operator, left as Expression, tr.expr(node.right)));
    }
    case 'LogicalExpression':
      return tr.wrapV(node, t.logicalExpression(node.operator, tr.expr(node.left), tr.expr(node.right)));
    case 'ConditionalExpression':
      return tr.wrapV(node, t.conditionalExpression(tr.expr(node.test), tr.expr(node.consequent), tr.expr(node.alternate)));
    case 'SequenceExpression':
      return t.sequenceExpression(node.expressions.map((e) => tr.expr(e)));
    case 'TaggedTemplateExpression': {
      const tag = t.isMemberExpression(node.tag) ? memberTarget(tr, node.tag) : tr.expr(node.tag, 'callee');
      return t.taggedTemplateExpression(tag, t.templateLiteral(node.quasi.quasis, node.quasi.expressions.map((e) => tr.expr(e as Expression))));
    }
    case 'YieldExpression':
      return yieldExpr(tr, node);
    case 'ParenthesizedExpression':
      return t.parenthesizedExpression(tr.expr(node.expression, role));
    default:
      return node;
  }
}
