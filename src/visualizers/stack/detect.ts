/**
 * Stacks: arrays pushed and popped — never shifted or unshifted (queues) nor sorted (priority queues) —
 * whose pops interleave with the pushes or whose top is peeked between them; push-only lists (results,
 * path copies, adjacency lists) don't count. One detection per variable: a function called again builds
 * its new stack in the same variable. Monotonic mode: see monotonic.ts.
 */
import type { ObjInfo, TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ObjId } from '../../engine/types/values';
import type { DetectContext, Detection } from '../types';
import { detectMonotonic, type MonotonicInfo } from './monotonic';
import { peekAt, stackOps } from './ops';

export interface StackBindings {
  target: VarRef;
  /** the first array the variable holds as a stack */
  objId: ObjId;
  monotonic?: MonotonicInfo;
}

export const STACK_SCORE = 0.85;

/** Pushed and popped like a stack: a pop before the last push, or a top peek between the first push and the last pop. */
function isStackLike(tl: Timeline, o: ObjInfo): boolean {
  const { ops } = o;
  if (o.kind !== 'array' || !ops.push || !ops.pop || ops.shift || ops.unshift || ops.sort) return false;
  const list = stackOps(tl, o.id);
  const firstPop = list.findIndex((op) => op.op === 'pop');
  if (firstPop >= 0 && firstPop < list.findLastIndex((op) => op.op === 'push')) return true;
  const to = list.findLast((op) => op.op === 'pop')?.step ?? -1;
  for (let s = list.find((op) => op.op === 'push')?.step ?? Infinity; s <= to; s++) if (peekAt(tl, o.id, s)) return true;
  return false;
}

/** The variable an array was created into (`const stack = []`), else the earliest one holding it. */
function ownerVar(tl: Timeline, a: TraceAnalysis, o: ObjInfo): VarInfo | undefined {
  const vars = [...o.varKeys].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
  const created = tl.diffs[o.allocStep]?.vars.find((c) => refId(c.value) === o.id);
  return vars.find((v) => created && v.ref.bids.includes(created.bid)) ?? vars.sort((x, y) => x.firstStep - y.firstStep)[0];
}

const activity = (objs: ObjInfo[]) => objs.reduce((n, o) => n + (o.ops.push ?? 0) + (o.ops.pop ?? 0), 0);

export function detectStacks({ tl, analysis: a }: DetectContext): Detection<StackBindings>[] {
  const byVar = new Map<string, { ref: VarRef; objs: ObjInfo[] }>();
  for (const o of a.objects.values()) {
    if (!isStackLike(tl, o)) continue;
    const owner = ownerVar(tl, a, o);
    if (!owner) continue;
    const group = byVar.get(varKey(owner.ref));
    if (group) group.objs.push(o);
    else byVar.set(varKey(owner.ref), { ref: owner.ref, objs: [o] });
  }
  // the busiest stack first (it becomes the primary when there are several)
  return [...byVar.values()].sort((x, y) => activity(y.objs) - activity(x.objs)).map(({ ref, objs }): Detection<StackBindings> => {
    const monotonic = detectMonotonic(tl, a, objs.map((o) => o.id), ref.fnId);
    // every array the variable holds is drawn (a call whose stack only fills and drains included)
    const held = [...(a.vars.get(varKey(ref))?.heapIds ?? [])].map((id) => a.objects.get(id));
    const shown = [...new Set([...objs, ...held])].filter((o): o is ObjInfo => o?.kind === 'array');
    const claims = [...shown.map((o) => `obj:${o.id}`), varKey(ref), ...shown.flatMap((o) => [...o.varKeys])];
    return {
      vizId: 'stack',
      key: `stack:${varKey(ref)}`,
      title: ref.name,
      score: STACK_SCORE,
      role: 'primary',
      ...(monotonic && { mode: 'monotonic' }),
      claims: [...new Set(claims)],
      bindings: { target: ref, objId: objs[0].id, ...(monotonic && { monotonic }) },
    };
  });
}
