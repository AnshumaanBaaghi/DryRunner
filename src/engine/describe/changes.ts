/** Human-readable heap changes for the variables panel and trace table (`dp[3]: 0 → 2`, `push(5)`). */
import type { V } from '../types/values';
import type { HeapChange, Snapshot, StepDiff, Timeline } from '../timeline/types';
import { orderedProps } from '../timeline/heap';
import { previewValue, refId } from '../timeline/values';

export interface ValueChange {
  /** path prefix relative to the variable, e.g. `[1]` for grid row 1 */
  prefix: string;
  text: string;
  change: HeapChange;
}

function fmt(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  return previewValue(tl, snap, v, { depth: 1, maxItems: 4, maxString: 20 });
}

export function keyText(path: (string | number)[]): string {
  const k = path[0];
  if (typeof k === 'number') return `[${k}]`;
  return /^[A-Za-z_$][\w$]*$/.test(String(k)) ? `.${k}` : `[${JSON.stringify(k)}]`;
}

export function heapChangeText(tl: Timeline, snap: Snapshot, h: HeapChange): string {
  const f = (v: V | undefined) => fmt(tl, snap, v);
  const args = (h.args ?? []).map(f).join(', ');
  switch (h.op) {
    case 'alloc': return 'created';
    case 'set': return h.old !== undefined ? `${keyText(h.path)}: ${f(h.old)} → ${f(h.value)}` : `${keyText(h.path)} = ${f(h.value)}`;
    case 'delete': return `delete ${keyText(h.path)}`;
    case 'length': return `length → ${h.length ?? '?'}`;
    case 'push': return `push(${args})`;
    case 'pop': return `pop() → ${f(h.old)}`;
    case 'shift': return `shift() → ${f(h.old)}`;
    case 'unshift': return `unshift(${args})`;
    case 'splice': return `splice(${h.path[0]}, ${h.removed?.length ?? 0}${args ? `, ${args}` : ''})`;
    case 'sort': return 'sorted';
    case 'reverse': return 'reversed';
    case 'fill': return 'filled';
    case 'copyWithin': return 'copyWithin(…)';
    case 'mapSet': return h.old !== undefined ? `set(${f(h.key)}): ${f(h.old)} → ${f(h.value)}` : `set(${f(h.key)}, ${f(h.value)})`;
    case 'mapDelete': return `delete(${f(h.key)})`;
    case 'setAdd': return `add(${f(h.key)})`;
    case 'setDelete': return `delete(${f(h.key)})`;
    case 'mapClear':
    case 'setClear': return 'clear()';
    default: return h.op;
  }
}

/** Changes made in this step to the object a variable points at (and, one level down, its children). */
export function changesForValue(tl: Timeline, snap: Snapshot, diff: StepDiff, v: V, limit = 4): ValueChange[] {
  const id = refId(v);
  if (id === null || diff.heap.length === 0) return [];
  const out: ValueChange[] = [];
  const childPrefix = new Map<number, string>();
  const obj = snap.heap.get(id);
  if (obj?.elems) obj.elems.forEach((e, i) => {
    const cid = refId(e);
    if (cid !== null && !childPrefix.has(cid)) childPrefix.set(cid, `[${i}]`);
  });
  if (obj?.props) for (const [k, slot] of orderedProps(obj)) {
    const cid = refId(slot.v);
    if (cid !== null && !childPrefix.has(cid)) childPrefix.set(cid, keyText([k]));
  }
  for (const h of diff.heap) {
    if (out.length >= limit) break;
    if (h.op === 'alloc') continue;
    if (h.id === id) out.push({ prefix: '', text: heapChangeText(tl, snap, h), change: h });
    else if (childPrefix.has(h.id)) out.push({ prefix: childPrefix.get(h.id) as string, text: heapChangeText(tl, snap, h), change: h });
  }
  return out;
}
