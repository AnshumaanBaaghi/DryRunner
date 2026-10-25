/**
 * Renders a statement's source with recorded sub-values substituted, the way you trace code on paper:
 *   index form  dp[i] = …        → dp[4] = …         (computed keys replaced)
 *   value form  dp[i-1] + dp[i-2] → 2 + 3            (reads/calls replaced by their values)
 */
import type { ExprMeta, ProgramMeta } from '../types/meta';
import type { Sub } from '../types/trace';
import type { V } from '../types/values';

export interface RNode {
  start: number;
  end: number;
  meta: ExprMeta | null;
  children: RNode[];
}

const READ_TYPES = new Set([
  'Identifier', 'MemberExpression', 'OptionalMemberExpression', 'CallExpression', 'OptionalCallExpression',
  'NewExpression', 'TemplateLiteral',
]);

/** Containment tree of the statement's instrumented sub-expressions within [start, end). */
export function exprTree(meta: ProgramMeta, sid: number, start: number, end: number): RNode {
  const nodes = meta.exprs
    .filter((e) => e.stmtId === sid && e.loc.start >= start && e.loc.end <= end)
    .sort((a, b) => a.loc.start - b.loc.start || b.loc.end - a.loc.end);
  const root: RNode = { start, end, meta: null, children: [] };
  const stack: RNode[] = [root];
  for (const e of nodes) {
    const node: RNode = { start: e.loc.start, end: e.loc.end, meta: e, children: [] };
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (node.start >= top.start && node.end <= top.end) break;
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

export function renderTree(source: string, node: RNode, replace: (n: RNode) => string | null, isRoot = true): string {
  if (!isRoot) {
    const r = replace(node);
    if (r !== null) return r;
  }
  let out = '';
  let pos = node.start;
  for (const child of node.children) {
    if (child.start < pos) continue;
    out += source.slice(pos, child.start) + renderTree(source, child, replace, false);
    pos = child.end;
  }
  return out + source.slice(pos, node.end);
}

export function subMap(sub: Sub[] | undefined): Map<number, V> {
  const m = new Map<number, V>();
  for (const [eid, v] of sub ?? []) m.set(eid, v);
  return m;
}

export function indexForm(source: string, tree: RNode, values: Map<number, V>, fmt: (v: V) => string): string {
  return renderTree(source, tree, (n) => (n.meta?.role === 'key' && values.has(n.meta.id) ? fmt(values.get(n.meta.id) as V) : null));
}

export function valueForm(source: string, tree: RNode, values: Map<number, V>, fmt: (v: V) => string): string {
  return renderTree(source, tree, (n) => {
    if (!n.meta || !values.has(n.meta.id)) return null;
    const type = n.meta.type;
    if (READ_TYPES.has(type) || (type === 'UnaryExpression' && n.meta.op === 'typeof')) return fmt(values.get(n.meta.id) as V);
    return null;
  });
}

/** Collapse whitespace so multi-line expressions fit the HUD. */
export function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
