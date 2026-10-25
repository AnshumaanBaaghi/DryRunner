/**
 * Pre-pass over the original AST: validation, ids for functions/loops, scope-resolved bindings
 * (identifier node → binding id) and the static analysis consumed by the pattern detector.
 */
import type { BindingKind, BindingMeta, ClassInfo, FnKind, FnMeta, LoopKind, LoopMeta, StaticAnalysis } from '../types/meta';
import { t, traverse, type BabelTypes, type Node, type NodePath } from './babel';
import { PREFIX } from './hooks';
import { InstrumentError, locOf } from './loc';

export const HOF_METHODS = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex',
  'findLast', 'findLastIndex', 'flatMap', 'sort', 'toSorted',
]);
export const MUTED_HOF = new Set(['sort', 'toSorted']);

export interface Analysis {
  fnIdOf: WeakMap<Node, number>;
  loopIdOf: WeakMap<Node, number>;
  bidOf: WeakMap<Node, number>;
  privateClasses: WeakSet<Node>;
  derivedClasses: WeakSet<Node>;
  implicitGlobals: { name: string; bid: number }[];
  fns: FnMeta[];
  loops: LoopMeta[];
  bindings: BindingMeta[];
  analysis: StaticAnalysis;
}

type AnyPath = NodePath<Node>;
type BabelBinding = NonNullable<ReturnType<AnyPath['scope']['getBinding']>>;

function fail(message: string, node: Node): never {
  throw new InstrumentError(message, node);
}

function keyName(key: Node, computed: boolean): string | null {
  if (!computed && t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  if (t.isNumericLiteral(key)) return String(key.value);
  return null;
}

/** Binding names introduced by a parameter list, in order (aligned with the `enter` hook's values). */
export function paramNames(params: Node[]): string[] {
  return params.flatMap((p) => Object.keys(t.getBindingIdentifiers(p)));
}

function paramLabel(p: Node): string {
  if (t.isIdentifier(p)) return p.name;
  if (t.isAssignmentPattern(p)) return paramLabel(p.left);
  if (t.isRestElement(p)) return `...${paramLabel(p.argument)}`;
  if (t.isObjectPattern(p)) return '{…}';
  if (t.isArrayPattern(p)) return '[…]';
  return '?';
}

function classNameOf(path: NodePath<BabelTypes.Class>): string | undefined {
  if (path.node.id) return path.node.id.name;
  const parent = path.parentPath;
  if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return parent.node.id.name;
  return undefined;
}

function inferFnName(path: NodePath<BabelTypes.Function>): string {
  const node = path.node;
  if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id) return node.id.name;
  if (t.isObjectMethod(node) || t.isClassMethod(node)) {
    const name = keyName(node.key, node.computed) ?? '[computed]';
    if (t.isClassMethod(node) && node.kind === 'constructor') {
      const cls = path.parentPath?.parentPath;
      return (cls && cls.isClass() ? classNameOf(cls) : undefined) ?? 'constructor';
    }
    return name;
  }
  if (t.isClassPrivateMethod(node)) return `#${node.key.id.name}`;
  const parent = path.parentPath;
  if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return parent.node.id.name;
  if (parent?.isAssignmentExpression()) {
    const left = parent.node.left;
    if (t.isIdentifier(left)) return left.name;
    if (t.isMemberExpression(left)) return keyName(left.property, left.computed) ?? 'anonymous';
  }
  if (parent?.isObjectProperty() || parent?.isClassProperty()) {
    return keyName(parent.node.key, parent.node.computed) ?? 'anonymous';
  }
  if (parent?.isCallExpression() || parent?.isNewExpression()) return 'callback';
  return 'anonymous';
}

function fnKindOf(node: BabelTypes.Function): FnKind {
  if (t.isArrowFunctionExpression(node)) return 'arrow';
  if (t.isClassMethod(node) || t.isClassPrivateMethod(node) || t.isObjectMethod(node)) {
    if (node.kind === 'constructor') return 'ctor';
    if (node.kind === 'get') return 'getter';
    if (node.kind === 'set') return 'setter';
    return 'method';
  }
  return 'function';
}

function loopKindOf(node: Node): LoopKind {
  if (t.isForStatement(node)) return 'for';
  if (t.isWhileStatement(node)) return 'while';
  if (t.isDoWhileStatement(node)) return 'doWhile';
  if (t.isForOfStatement(node)) return 'forOf';
  return 'forIn';
}

function identifiersIn(node: Node | null | undefined, out: Set<string>): void {
  if (!node) return;
  if (t.isIdentifier(node)) {
    out.add(node.name);
    return;
  }
  if (t.isMemberExpression(node)) {
    identifiersIn(node.object, out);
    if (node.computed) identifiersIn(node.property, out);
    return;
  }
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) child.forEach((c) => c && typeof c === 'object' && identifiersIn(c as Node, out));
    else if (child && typeof child === 'object') identifiersIn(child as Node, out);
  }
}

function assignedIn(node: Node | null | undefined, out: Set<string>): void {
  if (!node) return;
  if (t.isUpdateExpression(node) && t.isIdentifier(node.argument)) out.add(node.argument.name);
  if (t.isAssignmentExpression(node)) {
    for (const name of Object.keys(t.getBindingIdentifiers(node.left as Node))) out.add(name);
  }
  if (t.isFunction(node)) return;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) child.forEach((c) => c && typeof c === 'object' && assignedIn(c as Node, out));
    else if (child && typeof child === 'object') assignedIn(child as Node, out);
  }
}

function loopCounters(node: Node): string[] {
  const out = new Set<string>();
  if (t.isForStatement(node)) {
    if (t.isVariableDeclaration(node.init)) {
      for (const d of node.init.declarations) Object.keys(t.getBindingIdentifiers(d.id)).forEach((n) => out.add(n));
    } else assignedIn(node.init, out);
    assignedIn(node.update, out);
  } else if (t.isForOfStatement(node) || t.isForInStatement(node)) {
    Object.keys(t.getBindingIdentifiers(node.left as Node)).forEach((n) => out.add(n));
  } else if (t.isWhileStatement(node) || t.isDoWhileStatement(node)) {
    const inTest = new Set<string>();
    identifiersIn(node.test, inTest);
    const assigned = new Set<string>();
    assignedIn(node.body, assigned);
    for (const n of inTest) if (assigned.has(n)) out.add(n);
  }
  return [...out];
}

function isNonVariableIdentifier(path: NodePath<BabelTypes.Identifier>): boolean {
  const parent = path.parent;
  const node = path.node;
  if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === node && !parent.computed) return true;
  if ((t.isObjectProperty(parent) || t.isClassProperty(parent) || t.isObjectMethod(parent) || t.isClassMethod(parent)) &&
    parent.key === node && !parent.computed) {
    // shorthand `{ x }` uses the same node as key and value: treat it as a variable reference
    return !(t.isObjectProperty(parent) && parent.shorthand && parent.value === node);
  }
  if (t.isLabeledStatement(parent) || t.isBreakStatement(parent) || t.isContinueStatement(parent)) return true;
  if (t.isMetaProperty(parent) || t.isPrivateName(parent)) return true;
  return false;
}

function isAssignmentTarget(path: NodePath<BabelTypes.Identifier>): boolean {
  let child: AnyPath = path as AnyPath;
  let parent: AnyPath | null = path.parentPath as AnyPath | null;
  while (parent && (parent.isArrayPattern() || parent.isObjectPattern() || parent.isRestElement() ||
    (parent.isObjectProperty() && parent.parentPath?.isObjectPattern()) ||
    (parent.isAssignmentPattern() && parent.node.left === child.node))) {
    child = parent;
    parent = parent.parentPath as AnyPath | null;
  }
  if (!parent) return false;
  if (parent.isAssignmentExpression() && parent.node.left === child.node) return true;
  if (parent.isUpdateExpression()) return true;
  if ((parent.isForOfStatement() || parent.isForInStatement()) && parent.node.left === child.node) return true;
  return false;
}

const BINDING_KIND: Record<string, BindingKind> = {
  var: 'var', let: 'let', const: 'const', param: 'param', hoisted: 'function', local: 'const', module: 'const', unknown: 'var',
};

export function analyze(ast: BabelTypes.File): Analysis {
  const fnIdOf = new WeakMap<Node, number>();
  const loopIdOf = new WeakMap<Node, number>();
  const bidOf = new WeakMap<Node, number>();
  const privateClasses = new WeakSet<Node>();
  const derivedClasses = new WeakSet<Node>();
  const callbackFns = new WeakSet<Node>();
  const fns: FnMeta[] = [];
  const loops: LoopMeta[] = [];
  const bindings: BindingMeta[] = [];
  const classes: ClassInfo[] = [];
  const indexUsage: StaticAnalysis['indexUsage'] = [];
  const methodCalls: StaticAnalysis['methodCalls'] = [];
  const functions: StaticAnalysis['functions'] = [];
  let hasTopLevelCall = false;
  const program = ast.program;

  fnIdOf.set(program, 0);
  fns.push({
    id: 0, name: '(program)', params: [], loc: locOf(program), kind: 'program', lexParent: null,
    isCallback: false, isGenerator: false, selfRef: false,
  });

  const fnOf = (path: AnyPath): number => {
    const fp = path.getFunctionParent();
    return fp ? (fnIdOf.get(fp.node) ?? 0) : 0;
  };
  const parentLoopOf = (path: AnyPath): number | null => {
    const lp = path.findParent((p) => p.isFunction() || p.isLoop() ||
      (p.isCallExpression() && loopIdOf.has(p.node)));
    if (!lp || lp.isFunction()) {
      // a callback loop body is a function: report the hof loop as parent
      if (lp && lp.isFunction() && lp.parentPath?.isCallExpression() && loopIdOf.has(lp.parentPath.node)) {
        return loopIdOf.get(lp.parentPath.node) ?? null;
      }
      return null;
    }
    return loopIdOf.get(lp.node) ?? null;
  };

  // ── pass 1: validation, ids, static analysis ──
  traverse(ast, {
    Identifier(path) {
      if (path.node.name.startsWith(PREFIX)) fail(`Identifiers starting with "${PREFIX}" are reserved by AlgoScope.`, path.node);
    },
    Function(path) {
      const node = path.node;
      if (node.async) fail('async functions are not supported yet — AlgoScope traces synchronous code.', node);
      const fnId = fns.length;
      fnIdOf.set(node, fnId);
      let className: string | undefined;
      if (t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
        const cls = path.parentPath?.parentPath;
        if (cls?.isClass()) className = classNameOf(cls);
      }
      fns.push({
        id: fnId,
        name: inferFnName(path),
        params: paramNames(node.params),
        loc: locOf(node),
        kind: fnKindOf(node),
        className,
        lexParent: fnOf(path as AnyPath),
        isCallback: callbackFns.has(node),
        isGenerator: Boolean(node.generator),
        selfRef: false,
      });
      const top = !path.getFunctionParent();
      if (top && t.isFunctionDeclaration(node) && node.id) {
        functions.push({ fnId, name: node.id.name, params: node.params.map(paramLabel), line: node.loc?.start.line ?? 1 });
      } else if (top && (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
        path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id) &&
        path.parentPath.parentPath?.parentPath?.isProgram()) {
        functions.push({ fnId, name: path.parentPath.node.id.name, params: node.params.map(paramLabel), line: node.loc?.start.line ?? 1 });
      } else if (className && t.isClassMethod(node) && node.kind === 'method' && !node.static) {
        const cls = path.parentPath?.parentPath;
        if (cls && (cls.parentPath?.isProgram() || cls.parentPath?.parentPath?.parentPath?.isProgram())) {
          functions.push({ fnId, name: fns[fnId].name, params: node.params.map(paramLabel), line: node.loc?.start.line ?? 1, className });
        }
      }
    },
    Loop(path) {
      const node = path.node;
      if (t.isForOfStatement(node) && node.await) fail('for await…of is not supported.', node);
      const loopId = loops.length;
      loopIdOf.set(node, loopId);
      const label = path.parentPath?.isLabeledStatement() ? path.parentPath.node.label.name : undefined;
      loops.push({
        id: loopId, kind: loopKindOf(node), loc: locOf(node), fnId: fnOf(path as AnyPath),
        parent: parentLoopOf(path as AnyPath), counters: loopCounters(node), label,
      });
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (t.isIdentifier(callee) && callee.name === 'eval' && !path.scope.getBinding('eval')) {
        fail('eval is not supported.', path.node);
      }
      if (t.isImport(callee)) fail('Dynamic import() is not supported.', path.node);
      if (!path.getFunctionParent()) hasTopLevelCall = true;
      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
        if (t.isIdentifier(callee.object)) {
          methodCalls.push({ object: callee.object.name, method: callee.property.name, fnId: fnOf(path as AnyPath) });
        }
        if (HOF_METHODS.has(callee.property.name) && args.length > 0) {
          if (args[0] && t.isFunction(args[0])) callbackFns.add(args[0]);
          if (!MUTED_HOF.has(callee.property.name)) {
            const loopId = loops.length;
            loopIdOf.set(path.node, loopId);
            loops.push({
              id: loopId, kind: 'callback', loc: locOf(path.node), fnId: fnOf(path as AnyPath),
              parent: parentLoopOf(path as AnyPath), counters: [], method: callee.property.name,
            });
          }
        }
      }
    },
    NewExpression(path) {
      if (!path.getFunctionParent()) hasTopLevelCall = true;
    },
    MemberExpression(path) {
      const { object, property, computed } = path.node;
      if (!computed || !t.isIdentifier(object)) return;
      let index: string | null = null;
      if (t.isIdentifier(property)) index = property.name;
      else if (t.isBinaryExpression(property) && (property.operator === '+' || property.operator === '-') &&
        t.isIdentifier(property.left)) index = property.left.name;
      if (index) indexUsage.push({ object: object.name, index, fnId: fnOf(path as AnyPath) });
    },
    AwaitExpression(path) {
      fail('await is not supported yet — AlgoScope traces synchronous code.', path.node);
    },
    WithStatement(path) {
      fail('with statements are not supported.', path.node);
    },
    ImportDeclaration(path) {
      fail('import/export are not supported — paste plain functions and calls.', path.node);
    },
    ExportNamedDeclaration(path) {
      fail('import/export are not supported — paste plain functions and calls.', path.node);
    },
    ExportDefaultDeclaration(path) {
      fail('import/export are not supported — paste plain functions and calls.', path.node);
    },
    Class(path) {
      const node = path.node;
      let hasPrivate = false;
      const fields: string[] = [];
      const methods: string[] = [];
      for (const member of node.body.body) {
        if (t.isClassPrivateProperty(member) || t.isClassPrivateMethod(member)) hasPrivate = true;
        if (t.isClassProperty(member)) {
          const n = keyName(member.key, member.computed);
          if (n) fields.push(n);
        }
        if (t.isClassMethod(member)) {
          const n = keyName(member.key, member.computed);
          if (member.kind === 'constructor') {
            path.get('body').traverse({
              AssignmentExpression(ap) {
                const left = ap.node.left;
                if (t.isMemberExpression(left) && t.isThisExpression(left.object)) {
                  const f = keyName(left.property, left.computed);
                  if (f && !fields.includes(f)) fields.push(f);
                }
              },
            });
          } else if (n) methods.push(n);
        }
      }
      path.traverse({ PrivateName() { hasPrivate = true; } });
      if (hasPrivate) privateClasses.add(node);
      if (node.superClass) derivedClasses.add(node);
      const name = classNameOf(path);
      if (name) {
        classes.push({
          name, fields, methods, hasPrivate,
          superClass: t.isIdentifier(node.superClass) ? node.superClass.name : undefined,
        });
      }
    },
  });

  // ── pass 2: bindings and identifier resolution ──
  const bindingIds = new Map<object, number>();
  const unboundTargets = new Map<string, Node[]>();
  const unboundRefs: { name: string; node: Node }[] = [];
  const bindingFor = (binding: BabelBinding, name: string): number => {
    const existing = bindingIds.get(binding);
    if (existing !== undefined) return existing;
    const id = bindings.length;
    bindingIds.set(binding, id);
    const block = binding.scope.block;
    const fnScope = binding.scope.getFunctionParent();
    const kind = BINDING_KIND[binding.kind] ?? 'var';
    const meta: BindingMeta = {
      id, name, kind, fnId: fnScope ? (fnIdOf.get(fnScope.block) ?? 0) : 0, scopeStart: block.start ?? 0, scopeEnd: block.end ?? 0,
    };
    if (t.isLoop(block) && kind !== 'var') {
      meta.loopId = loopIdOf.get(block);
      meta.loopScope = 'head';
    }
    bindings.push(meta);
    return id;
  };

  traverse(ast, {
    Identifier(path) {
      if (isNonVariableIdentifier(path)) return;
      const name = path.node.name;
      const binding = path.scope.getBinding(name);
      if (binding) {
        bidOf.set(path.node, bindingFor(binding, name));
        return;
      }
      if (isAssignmentTarget(path)) {
        const list = unboundTargets.get(name) ?? [];
        list.push(path.node);
        unboundTargets.set(name, list);
      } else {
        unboundRefs.push({ name, node: path.node });
      }
    },
    BlockStatement(path) {
      // block-scoped bindings declared directly in a loop body reset every iteration
      const parent = path.parentPath;
      if (!parent?.isLoop()) return;
      const loopId = loopIdOf.get(parent.node);
      for (const binding of Object.values(path.scope.bindings)) {
        const id = bindingFor(binding, binding.identifier.name);
        if (bindings[id] && bindings[id].kind !== 'var') {
          bindings[id].loopId = loopId;
          bindings[id].loopScope = 'body';
        }
      }
    },
  });

  const implicitGlobals: Analysis['implicitGlobals'] = [];
  for (const [name, nodes] of unboundTargets) {
    const id = bindings.length;
    bindings.push({ id, name, kind: 'implicit', fnId: 0, scopeStart: program.start ?? 0, scopeEnd: program.end ?? 0 });
    implicitGlobals.push({ name, bid: id });
    for (const node of nodes) bidOf.set(node, id);
  }
  for (const ref of unboundRefs) {
    const g = implicitGlobals.find((ig) => ig.name === ref.name);
    if (g) bidOf.set(ref.node, g.bid);
  }

  // self references: a function whose own name binding is referenced inside its body
  traverse(ast, {
    Function(path) {
      const fnId = fnIdOf.get(path.node);
      if (fnId === undefined) return;
      const node = path.node;
      let nameNode: Node | null = null;
      if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id) nameNode = node.id;
      else if (path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id)) nameNode = path.parentPath.node.id;
      const ownBid = nameNode ? bidOf.get(nameNode) : undefined;
      const methodName = (t.isClassMethod(node) || t.isObjectMethod(node)) ? keyName(node.key, node.computed) : null;
      let self = false;
      path.get('body').traverse({
        Identifier(ip) {
          if (ownBid !== undefined && bidOf.get(ip.node) === ownBid && ip.node !== nameNode) self = true;
        },
        MemberExpression(mp) {
          if (methodName && t.isThisExpression(mp.node.object) && keyName(mp.node.property, mp.node.computed) === methodName &&
            mp.parentPath.isCallExpression({ callee: mp.node })) self = true;
        },
      });
      fns[fnId].selfRef = self;
    },
  });

  const hasTopLevelCode = program.body.some((s) => !(t.isFunctionDeclaration(s) || t.isClassDeclaration(s) ||
    t.isEmptyStatement(s) || t.isVariableDeclaration(s)));

  return {
    fnIdOf, loopIdOf, bidOf, privateClasses, derivedClasses, implicitGlobals, fns, loops, bindings,
    analysis: { indexUsage, methodCalls, classes, hasTopLevelCall: hasTopLevelCall || hasTopLevelCode, functions },
  };
}
