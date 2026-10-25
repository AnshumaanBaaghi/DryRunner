/** Pure helpers for the recursion tree: compact call labels and the arrays of divide-and-conquer calls. */
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, refId } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import type { TreeNode } from '../shared/callTree';

/** `fib(3)`; arguments that are the same object in every call are left out: `quickSort(0, 7)`. */
export function shortLabel(tl: Timeline, snap: Snapshot, node: TreeNode, constant: ReadonlySet<number> = new Set()): string {
  const args = node.args.filter((_, k) => !constant.has(k)).map((v) => previewValue(tl, snap, v, { depth: 0, maxString: 8 }));
  return `${tl.meta.fns[node.fnId]?.name ?? 'call'}(${args.join(', ')})`;
}

export interface DcArrays {
  /** the first array argument, as it was when the call was made */
  input: V[] | null;
  /** the array the call returned */
  output: V[] | null;
}

const elementsAt = (tl: Timeline, step: number | undefined, v: V | undefined): V[] | null => {
  const id = refId(v);
  if (id === null || step === undefined) return null;
  return tl.snapshots[step]?.heap.get(id)?.elems?.toArray() ?? null;
};

export function dcArrays(tl: Timeline, node: TreeNode): DcArrays {
  const arg = node.args.find((v) => refId(v) !== null && tl.snapshots[node.enterStep]?.heap.get(refId(v)!)?.kind === 'array');
  return { input: elementsAt(tl, node.enterStep, arg), output: elementsAt(tl, node.returnStep, node.value) };
}

/** The innermost running call of `fnId` at step i (e.g. the merge in progress), or null. */
export function runningCall(tl: Timeline, i: number, fnId: number): number | null {
  for (let call = tl.calls.get(tl.steps[i]?.callId ?? -1); call; call = tl.calls.get(call.parentId)) {
    if (call.fnId === fnId) return call.exitStep !== undefined && call.exitStep <= i ? null : call.callId;
    if (call.parentId === call.callId) break;
  }
  return null;
}

/** Each element's slot before and after the call: equal values keep their relative order (a stable sort). */
export function sortMoves(input: V[], output: V[]): { value: V; from: number; to: number }[] {
  const key = (v: V) => JSON.stringify(v);
  const pending = new Map<string, number[]>();
  input.forEach((v, k) => pending.set(key(v), [...(pending.get(key(v)) ?? []), k]));
  return output.map((v, to) => {
    const slots = pending.get(key(v));
    const from = slots?.length ? slots.shift()! : to;
    return { value: v, from, to };
  });
}
