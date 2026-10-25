/**
 * Statement-level instrumentation. Each executed statement becomes a "completed unit" step:
 * `__as_t.s(sid)` marks the position, the hook that closes the unit (`e`, `d`, `c`, `ret`, …)
 * emits the step. Expressions, loops, functions and patterns live in sibling modules.
 */
import type { AssignShape, ExprMeta, StmtKind, StmtMeta } from '../types/meta';
import type { Analysis } from './analyze';
import { t, type BabelTypes, type Expression, type Identifier, type Node, type Statement } from './babel';
import { arr, handleName, hook, hookStmt, id, num, PREFIX, undef } from './hooks';
import { InstrumentError, locOf } from './loc';
import { transformExpression, type Role } from './expressions';
import { transformLoop } from './loops';
import { transformClass, transformFunction } from './functions';
import { declarator, transformPattern } from './patterns';

export interface FnCtx {
  fnId: number;
  handle: string;
  temps: string[];
  parent: FnCtx | null;
  /** Context whose `this` is visible here (arrows inherit it). */
  thisOwner: FnCtx;
  /** `__as_self` inside constructors (replaces `this`), null elsewhere. */
  selfName: string | null;
  derivedCtor: boolean;
  /** Class field initializers: `this` → `__as_t.p(this)`. */
  thisProxy: boolean;
}

const range = (n: Node): [number, number] => [n.start ?? 0, n.end ?? 0];

/** Target/value ranges for `x = …`, `a[i] += …`, `i++`, `let x = …` (single declarator). */
function assignShape(node: Node): AssignShape | null {
  const e = t.isExpressionStatement(node) ? node.expression : node;
  if (t.isAssignmentExpression(e)) return { op: e.operator, target: range(e.left), value: range(e.right) };
  if (t.isUpdateExpression(e)) return { op: e.operator, target: range(e.argument), value: null, prefix: e.prefix };
  if (t.isVariableDeclaration(e) && e.declarations.length === 1) {
    const d = e.declarations[0];
    return { op: '=', target: range(d.id), value: d.init ? range(d.init) : null };
  }
  return null;
}

export interface DeclaredBinding {
  bid: number;
  name: string;
}

export class Transformer {
  readonly stmts: StmtMeta[] = [];
  readonly exprs: ExprMeta[] = [];
  fn: FnCtx;
  /** Statement whose sub-values are being captured; null outside step statements. */
  stepSid: number | null = null;
  /** True while transforming parameter defaults (function handle not yet declared). */
  inParams = false;
  /** Functions whose parameter list is being transformed: their handle is not in scope there. */
  readonly paramScope = new Set<number>();
  private uidCounter = 0;
  private readonly strict: boolean;

  readonly a: Analysis;

  constructor(a: Analysis, program: BabelTypes.Program) {
    this.a = a;
    const root: FnCtx = {
      fnId: 0, handle: handleName(0), temps: [], parent: null, thisOwner: undefined as unknown as FnCtx,
      selfName: null, derivedCtor: false, thisProxy: false,
    };
    root.thisOwner = root;
    this.fn = root;
    this.strict = program.directives.some((d) => d.value.value === 'use strict');
  }

  // ── metadata ──
  addStmt(kind: StmtKind, node: Node, extra: { declares?: number[]; loopId?: number } = {}): number {
    const sid = this.stmts.length;
    const meta: StmtMeta = { id: sid, kind, loc: locOf(node), fnId: this.fn.fnId, ...extra };
    const shape = assignShape(node);
    if (shape) meta.assign = shape;
    const arg = t.isReturnStatement(node) || t.isThrowStatement(node) ? node.argument : null;
    if (arg) meta.value = [arg.start ?? 0, arg.end ?? 0];
    this.stmts.push(meta);
    return sid;
  }

  addExpr(node: Node, role?: 'key'): number {
    const eid = this.exprs.length;
    const op = (node as { operator?: string }).operator;
    const meta: ExprMeta = { id: eid, stmtId: this.stepSid ?? -1, loc: locOf(node), type: node.type };
    if (op) meta.op = op;
    if (role) meta.role = role;
    this.exprs.push(meta);
    return eid;
  }

  uid(tag: string): string {
    this.uidCounter += 1;
    return `${PREFIX}${tag}${this.uidCounter}`;
  }

  /** Function-scoped temporary (declared with `let` at the top of the current function body). */
  temp(): Identifier {
    const name = this.uid('t');
    this.fn.temps.push(name);
    return id(name);
  }

  withStep<R>(sid: number, f: () => R): R {
    const saved = this.stepSid;
    this.stepSid = sid;
    try {
      return f();
    } finally {
      this.stepSid = saved;
    }
  }

  withoutStep<R>(f: () => R): R {
    const saved = this.stepSid;
    this.stepSid = null;
    try {
      return f();
    } finally {
      this.stepSid = saved;
    }
  }

  /** `__as_t.v(eid, e)` inside step statements (records the evaluated sub-value). */
  wrapV(orig: Node, e: Expression, role?: 'key'): Expression {
    if (this.stepSid === null) return e;
    return hook('v', [num(this.addExpr(orig, role)), e]);
  }

  /** Track objects produced by calls/new; also record the sub-value inside step statements. */
  wrapVO(orig: Node, e: Expression): Expression {
    if (this.stepSid === null) return hook('o', [e]);
    return hook('vo', [num(this.addExpr(orig)), e]);
  }

  track(e: Expression): Expression {
    return hook('o', [e]);
  }

  /** Frame handle of the function declaring `bid`, or null when that handle is not in scope here. */
  handleFor(bid: number): Expression | null {
    const fnId = this.a.bindings[bid]?.fnId ?? 0;
    if (this.inParams || this.paramScope.has(fnId)) return null;
    return id(handleName(fnId));
  }

  expr(node: Expression, role: Role = 'value'): Expression {
    return transformExpression(this, node, role);
  }

  exprNoStep(node: Expression): Expression {
    return this.withoutStep(() => transformExpression(this, node, 'value'));
  }

  declaredBindings(node: Node): DeclaredBinding[] {
    const out: DeclaredBinding[] = [];
    const ids = t.getBindingIdentifiers(node, true) as unknown as Record<string, Identifier | Identifier[]>;
    for (const value of Object.values(ids)) {
      for (const ident of Array.isArray(value) ? value : [value]) {
        const bid = this.a.bidOf.get(ident);
        if (bid !== undefined && !out.some((b) => b.bid === bid)) out.push({ bid, name: ident.name });
      }
    }
    return out;
  }

  // ── program / blocks ──
  program(program: BabelTypes.Program): Statement[] {
    const body = this.block(program.body);
    const prologue: Statement[] = [
      t.variableDeclaration('const', [t.variableDeclarator(id(this.fn.handle), hook('main', []))]),
    ];
    if (!this.strict && this.a.implicitGlobals.length) {
      prologue.push(t.variableDeclaration('var', this.a.implicitGlobals.map((g) => t.variableDeclarator(id(g.name)))));
    }
    if (this.fn.temps.length) {
      prologue.push(t.variableDeclaration('let', this.fn.temps.map((n) => t.variableDeclarator(id(n)))));
    }
    return [...prologue, ...body];
  }

  block(stmts: Statement[]): Statement[] {
    return stmts.flatMap((s) => this.stmt(s));
  }

  asBlock(node: Statement): BabelTypes.BlockStatement {
    if (t.isBlockStatement(node)) return t.blockStatement(this.block(node.body), node.directives);
    return t.blockStatement(this.stmt(node));
  }

  stmt(node: Statement): Statement[] {
    switch (node.type) {
      case 'ExpressionStatement': {
        const sid = this.addStmt('expr', node);
        const e = this.withStep(sid, () => this.expr(node.expression));
        return [t.expressionStatement(hook('e', [hook('s', [num(sid)]), e]))];
      }
      case 'VariableDeclaration':
        return this.variableDeclaration(node);
      case 'FunctionDeclaration':
        return [transformFunction(this, node)];
      case 'ClassDeclaration': {
        const cls = transformClass(this, node);
        if (node.id && this.a.privateClasses.has(node)) return [cls, hookStmt('np', [id(node.id.name)])];
        return [cls];
      }
      case 'ReturnStatement': {
        const sid = this.addStmt('return', node);
        const value = node.argument ? this.withStep(sid, () => this.expr(node.argument as Expression)) : undef();
        return [t.returnStatement(hook('ret', [hook('s', [num(sid)]), id(this.fn.handle), value]))];
      }
      case 'IfStatement': {
        const sid = this.addStmt('if', node.test);
        const test = this.withStep(sid, () => this.expr(node.test));
        return [t.ifStatement(hook('c', [hook('s', [num(sid)]), test]), this.asBlock(node.consequent),
          node.alternate ? this.asBlock(node.alternate) : null)];
      }
      case 'BlockStatement':
        return [t.blockStatement(this.block(node.body), node.directives)];
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForOfStatement':
      case 'ForInStatement':
        return transformLoop(this, node, null);
      case 'LabeledStatement': {
        if (t.isLoop(node.body)) return transformLoop(this, node.body, node.label);
        return [t.labeledStatement(id(node.label.name), this.asBlock(node.body))];
      }
      case 'BreakStatement':
      case 'ContinueStatement': {
        const sid = this.addStmt(node.type === 'BreakStatement' ? 'break' : 'continue', node);
        return [hookStmt('st', [num(sid)]), t.cloneNode(node, true)];
      }
      case 'ThrowStatement': {
        const sid = this.addStmt('throw', node);
        const value = this.withStep(sid, () => this.expr(node.argument));
        return [t.throwStatement(hook('thr', [hook('s', [num(sid)]), value]))];
      }
      case 'TryStatement':
        return [this.tryStatement(node)];
      case 'SwitchStatement':
        return [this.switchStatement(node)];
      case 'EmptyStatement':
        return [];
      case 'DebuggerStatement':
        return [hookStmt('st', [num(this.addStmt('debugger', node))])];
      default:
        throw new InstrumentError(`Unsupported statement: ${node.type}`, node);
    }
  }

  private variableDeclaration(node: BabelTypes.VariableDeclaration): Statement[] {
    const declared = this.declaredBindings(node);
    const sid = this.addStmt('decl', node, { declares: declared.map((d) => d.bid) });
    const declarators = this.withStep(sid, () => node.declarations.flatMap((d) => declarator(this, d)));
    return [
      hookStmt('s', [num(sid)]),
      t.variableDeclaration(node.kind as 'var' | 'let' | 'const', declarators),
      hookStmt('d', [num(sid), arr(declared.map((d) => num(d.bid))), arr(declared.map((d) => id(d.name)))]),
    ];
  }

  private tryStatement(node: BabelTypes.TryStatement): Statement {
    const block = t.blockStatement(this.block(node.block.body));
    let handler: BabelTypes.CatchClause | null = null;
    if (node.handler) {
      const h = node.handler;
      const declared = h.param ? this.declaredBindings(h.param) : [];
      const sid = this.addStmt('catch', h, { declares: declared.map((d) => d.bid) });
      const errId = id(this.uid('e'));
      const prologue: Statement[] = [hookStmt('ct', [num(sid), errId])];
      let param: BabelTypes.Identifier | BabelTypes.Pattern = errId;
      if (h.param && t.isIdentifier(h.param)) {
        param = id(h.param.name);
        prologue[0] = hookStmt('ct', [num(sid), id(h.param.name)]);
      } else if (h.param) {
        prologue.push(t.variableDeclaration('let', [
          t.variableDeclarator(this.withoutStep(() => transformPattern(this, h.param as BabelTypes.LVal)) as BabelTypes.VariableDeclarator['id'], id(errId.name)),
        ]));
      }
      handler = t.catchClause(param, t.blockStatement([...prologue, ...this.block(h.body.body)]));
    }
    const finalizer = node.finalizer ? t.blockStatement(this.block(node.finalizer.body)) : null;
    return t.tryStatement(block, handler, finalizer);
  }

  private switchStatement(node: BabelTypes.SwitchStatement): Statement {
    const sid = this.addStmt('switch', node.discriminant);
    const disc = this.withStep(sid, () => this.expr(node.discriminant));
    const cases = node.cases.map((c, i) => t.switchCase(
      c.test ? this.exprNoStep(c.test) : null,
      c.consequent.length ? [hookStmt('cm', [num(sid), num(i)]), ...this.block(c.consequent)] : [],
    ));
    return t.switchStatement(hook('sw', [hook('s', [num(sid)]), disc]), cases);
  }
}
