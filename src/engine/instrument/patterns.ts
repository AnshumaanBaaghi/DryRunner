/** Destructuring patterns and declarators (native destructuring is kept; only targets/defaults are rewritten). */
import { t, type BabelTypes, type Expression, type Node } from './babel';
import { hook, id } from './hooks';
import { literalNoTrack, memberTarget, transformKey } from './expressions';
import type { Transformer } from './transformer';

type PatternNode = BabelTypes.LVal | BabelTypes.PatternLike | BabelTypes.ObjectProperty | BabelTypes.RestElement;

export function transformPattern(tr: Transformer, node: PatternNode, renames?: { orig: string; tmp: string }[]): Node {
  switch (node.type) {
    case 'Identifier':
      return id(node.name);
    case 'MemberExpression':
      return memberTarget(tr, node);
    // Patterns are assembled field by field: Babel's builders reject member targets inside object
    // patterns and defaults (`({ p: arr[2] = 0 } = o)`) that the parser itself produces.
    case 'AssignmentPattern': {
      const left = transformPattern(tr, node.left, renames) as BabelTypes.AssignmentPattern['left'];
      const pattern = t.assignmentPattern(id('_'), tr.expr(node.right));
      pattern.left = left;
      return pattern;
    }
    case 'ArrayPattern':
      return t.arrayPattern(node.elements.map((el) => (el ? (transformPattern(tr, el, renames) as BabelTypes.PatternLike) : null)));
    case 'ObjectPattern': {
      const pattern = t.objectPattern([]);
      pattern.properties = node.properties.map((p) => {
        if (t.isRestElement(p)) return transformPattern(tr, p, renames) as BabelTypes.RestElement;
        const key = p.computed ? transformKey(tr, p.key) : p.key;
        const value = transformPattern(tr, p.value as PatternNode, renames) as BabelTypes.ObjectProperty['value'];
        const prop = t.objectProperty(key as Expression, id('_'), p.computed, false);
        prop.value = value;
        prop.shorthand = p.shorthand && !p.computed && t.isIdentifier(key) &&
          ((t.isIdentifier(value) && value.name === key.name) ||
            (t.isAssignmentPattern(value) && t.isIdentifier(value.left) && value.left.name === key.name));
        return prop;
      });
      return pattern;
    }
    case 'RestElement': {
      if (renames && t.isIdentifier(node.argument)) {
        const tmp = tr.uid('r');
        renames.push({ orig: node.argument.name, tmp });
        return t.restElement(id(tmp));
      }
      return t.restElement(transformPattern(tr, node.argument, renames) as BabelTypes.LVal);
    }
    default:
      return node;
  }
}

/** Identifier targets of an assignment pattern (member targets are tracked by the membrane). */
export function destructuringTargets(pattern: Node): { names: BabelTypes.Identifier[]; rests: BabelTypes.Identifier[] } {
  const names: BabelTypes.Identifier[] = [];
  const rests: BabelTypes.Identifier[] = [];
  const walk = (n: Node | null | undefined): void => {
    if (!n) return;
    if (t.isIdentifier(n)) names.push(n);
    else if (t.isAssignmentPattern(n)) walk(n.left);
    else if (t.isArrayPattern(n)) n.elements.forEach(walk);
    else if (t.isObjectPattern(n)) n.properties.forEach((p) => (t.isRestElement(p) ? walk(p) : walk(p.value)));
    else if (t.isRestElement(n)) {
      if (t.isIdentifier(n.argument)) rests.push(n.argument);
      walk(n.argument);
    }
  };
  walk(pattern);
  return { names, rests };
}

/**
 * `const {a, ...rest} = obj` → `const {a, ...__as_r1} = obj, rest = __as_t.o(__as_r1)`: rest copies are
 * created natively, so they are re-declared as tracked objects (works for const as well).
 */
export function declarator(tr: Transformer, d: BabelTypes.VariableDeclarator): BabelTypes.VariableDeclarator[] {
  const renames: { orig: string; tmp: string }[] = [];
  const pattern = transformPattern(tr, d.id as PatternNode, renames) as BabelTypes.LVal;
  let init: Expression | null = null;
  if (d.init) {
    const destructured = t.isArrayPattern(d.id) || t.isObjectPattern(d.id);
    init = destructured && (t.isArrayExpression(d.init) || t.isObjectExpression(d.init))
      ? literalNoTrack(tr, d.init)
      : tr.expr(d.init);
  }
  return [
    t.variableDeclarator(pattern as BabelTypes.VariableDeclarator['id'], init),
    ...renames.map((r) => t.variableDeclarator(id(r.orig), hook('o', [id(r.tmp)]))),
  ];
}
