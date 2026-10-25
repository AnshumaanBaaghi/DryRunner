/** Static program metadata produced by the instrumenter (ids are dense array indexes). */

export interface Loc {
  line: number; // 1-based
  col: number; // 0-based
  endLine: number;
  endCol: number;
  start: number; // source offsets
  end: number;
}

export type StmtKind =
  | 'expr'
  | 'decl'
  | 'return'
  | 'implicitReturn'
  | 'if'
  | 'switch'
  | 'loopInit'
  | 'loopTest'
  | 'loopUpdate'
  | 'forOf'
  | 'forIn'
  | 'break'
  | 'continue'
  | 'throw'
  | 'catch'
  | 'debugger';

/** Source offsets of the parts of an assignment-like statement (for the HUD's evaluation chain). */
export interface AssignShape {
  op: string;
  target: [number, number];
  value: [number, number] | null;
  prefix?: boolean;
}

export interface StmtMeta {
  id: number;
  kind: StmtKind;
  loc: Loc;
  fnId: number;
  loopId?: number;
  declares?: number[];
  assign?: AssignShape;
  /** return / throw argument range */
  value?: [number, number];
}

export interface ExprMeta {
  id: number;
  stmtId: number;
  loc: Loc;
  type: string;
  op?: string;
  /** 'key' marks the computed key of a member expression (rendered in "index form": dp[i] → dp[4]). */
  role?: 'key';
}

export type FnKind = 'program' | 'function' | 'arrow' | 'method' | 'ctor' | 'getter' | 'setter';

export interface FnMeta {
  id: number;
  name: string;
  params: string[];
  loc: Loc;
  kind: FnKind;
  className?: string;
  lexParent: number | null;
  isCallback: boolean;
  isGenerator: boolean;
  /** The function body references its own name (direct recursion candidate). */
  selfRef: boolean;
}

export type LoopKind = 'for' | 'while' | 'doWhile' | 'forOf' | 'forIn' | 'callback';

export interface LoopMeta {
  id: number;
  kind: LoopKind;
  loc: Loc;
  fnId: number;
  parent: number | null;
  counters: string[];
  label?: string;
  method?: string;
}

export type BindingKind = 'var' | 'let' | 'const' | 'param' | 'function' | 'class' | 'catch' | 'implicit';

export interface BindingMeta {
  id: number;
  name: string;
  kind: BindingKind;
  fnId: number;
  /** Source range of the scope block where the binding is visible. */
  scopeStart: number;
  scopeEnd: number;
  /** Loop owning this block-scoped binding: 'head' (for-let, lives for the loop) or 'body' (reset per iteration). */
  loopId?: number;
  loopScope?: 'head' | 'body';
}

export interface ClassInfo {
  name: string;
  fields: string[];
  methods: string[];
  hasPrivate: boolean;
  superClass?: string;
}

export interface StaticAnalysis {
  /** `X[P]` usages: object identifier name, index identifier name (or `P±k` base), enclosing fn. */
  indexUsage: { object: string; index: string; fnId: number }[];
  /** `X.m(...)` call sites on identifiers. */
  methodCalls: { object: string; method: string; fnId: number }[];
  classes: ClassInfo[];
  hasTopLevelCall: boolean;
  functions: { fnId: number; name: string; params: string[]; line: number; className?: string }[];
}

export interface ProgramMeta {
  source: string;
  stmts: StmtMeta[];
  exprs: ExprMeta[];
  fns: FnMeta[];
  loops: LoopMeta[];
  bindings: BindingMeta[];
  analysis: StaticAnalysis;
}

export interface CompileError {
  message: string;
  line: number;
  col: number;
}
