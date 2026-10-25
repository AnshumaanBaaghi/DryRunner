/**
 * Recursion trees: one detection per group of (mutually) recursive functions. Divide-and-conquer mode
 * when calls receive distinct sub-arrays (merge sort): nodes then show their arrays, and the helper that
 * combines sub-results (merge) gets a panel with its arrays and index pointers.
 */
import { resolveVarKey, type TraceAnalysis, type VarInfo } from '../../engine/detect/analysis';
import { varKey } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ArrayBindings } from '../array/detect';
import type { DetectContext, Detection } from '../types';

export interface RecursionBindings {
  fnIds: number[];
  /** divide and conquer: calls work on their own sub-arrays */
  dc: boolean;
  /** helper combining sub-results (e.g. merge): its arrays and pointers, shown while it runs */
  combine?: { fnId: number; arrays: ArrayBindings[] };
}

/** Recursive functions grouped by calling each other (mutual recursion forms one tree). */
function recursionGroups(tl: Timeline, recursive: Set<number>): number[][] {
  const root = new Map<number, number>([...recursive].map((f) => [f, f]));
  const find = (f: number): number => {
    const r = root.get(f)!;
    if (r === f) return f;
    const top = find(r);
    root.set(f, top);
    return top;
  };
  for (const call of tl.calls.values()) {
    const caller = tl.calls.get(call.parentId);
    if (caller && recursive.has(call.fnId) && recursive.has(caller.fnId)) root.set(find(call.fnId), find(caller.fnId));
  }
  const groups = new Map<number, number[]>();
  for (const f of recursive) groups.set(find(f), [...(groups.get(find(f)) ?? []), f]);
  return [...groups.values()];
}

const isArray = (a: TraceAnalysis, v: unknown) => {
  const id = refId(v as never);
  return id !== null && a.objects.get(id)?.kind === 'array';
};

/** Some argument position receives at least three different arrays across the calls. */
function takesSubArrays(tl: Timeline, a: TraceAnalysis, fnIds: Set<number>): boolean {
  const byPosition = new Map<number, Set<number>>();
  for (const call of tl.calls.values()) {
    if (!fnIds.has(call.fnId)) continue;
    call.args.forEach((v, k) => {
      if (!isArray(a, v)) return;
      byPosition.set(k, (byPosition.get(k) ?? new Set<number>()).add(refId(v)!));
    });
  }
  return [...byPosition.values()].some((ids) => ids.size >= 3);
}

function indexPointers(ctx: DetectContext, name: string, fnId: number): ArrayBindings['pointers'] {
  const out = new Map<string, VarInfo>();
  for (const u of ctx.tl.meta.analysis.indexUsage) {
    if (u.object !== name || u.fnId !== fnId) continue;
    const key = resolveVarKey(ctx.analysis, u.index, u.fnId);
    const info = key ? ctx.analysis.vars.get(key) : undefined;
    if (info && info.kinds.has('int')) out.set(key as string, info);
  }
  return [...out.values()].map((info) => ({ ref: info.ref, role: 'pointer' as const }));
}

/** The non-recursive helper most often called with arrays from the tree's calls (merge). */
function combineHelper(ctx: DetectContext, fnIds: Set<number>): RecursionBindings['combine'] {
  const { tl, analysis: a } = ctx;
  const counts = new Map<number, number>();
  for (const call of tl.calls.values()) {
    const caller = tl.calls.get(call.parentId);
    if (!caller || !fnIds.has(caller.fnId) || fnIds.has(call.fnId) || tl.meta.fns[call.fnId]?.isCallback) continue;
    if (call.args.some((v) => isArray(a, v))) counts.set(call.fnId, (counts.get(call.fnId) ?? 0) + 1);
  }
  const best = [...counts].sort((x, y) => y[1] - x[1])[0];
  if (!best) return undefined;
  const fnId = best[0];
  const params = tl.meta.fns[fnId]?.params ?? [];
  const arrays = [...a.vars.values()]
    .filter((info) => info.ref.fnId === fnId && [...info.heapIds].some((id) => a.objects.get(id)?.kind === 'array'))
    .sort((x, y) => {
      const px = params.indexOf(x.ref.name);
      const py = params.indexOf(y.ref.name);
      return (px < 0 ? 99 : px) - (py < 0 ? 99 : py) || x.firstStep - y.firstStep;
    })
    .slice(0, 4)
    .map((info): ArrayBindings => ({ target: info.ref, isString: false, pointers: indexPointers(ctx, info.ref.name, fnId) }));
  return arrays.length ? { fnId, arrays } : undefined;
}

export function detectRecursion(ctx: DetectContext): Detection<RecursionBindings>[] {
  const { tl, analysis: a } = ctx;
  return recursionGroups(tl, a.recursiveFns).map((group) => {
    const fnIds = new Set(group);
    const dc = takesSubArrays(tl, a, fnIds);
    const combine = dc ? combineHelper(ctx, fnIds) : undefined;
    const names = group.map((f) => tl.meta.fns[f]?.name ?? 'f');
    return {
      vizId: 'recursionTree',
      key: `recursionTree:${group.join('-')}`,
      title: names.join(' ↔ '),
      score: 0.8,
      role: 'primary' as const,
      mode: dc ? 'divide-and-conquer' : undefined,
      claims: [...group.map((f) => `fn:${f}`), ...(combine?.arrays.map((x) => varKey(x.target)) ?? [])],
      bindings: { fnIds: group, dc, combine },
    };
  });
}
