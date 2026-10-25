/** HUD lines for a linked list: nodes created, links rewritten (`curr.next: 2 → null`), pointers moving. */
import type { Timeline } from '../../engine/timeline/types';
import { previewValue, refId } from '../../engine/timeline/values';
import { isUndef, type ObjId, type V } from '../../engine/types/values';
import type { Detection } from '../types';
import type { LinkedListBindings } from './detect';
import { nodeLabel, pointerTrack } from './model';

/** `a.b.next` → the object expression (`a.b`) and the written key (`next`) */
const MEMBER = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*([A-Za-z_$][\w$]*)$/;

const nullish = (v: V | undefined) => v === undefined || v === null || isUndef(v);
const sameTarget = (x: V | undefined, y: V | undefined) => (nullish(x) && nullish(y)) || (refId(x) !== null && refId(x) === refId(y));

/** Whether `path` (a pointer, then properties) refers to node `id` at step i. */
function refersTo(tl: Timeline, i: number, b: LinkedListBindings, path: string[], id: ObjId): boolean {
  const [head, ...rest] = path;
  const ref = b.pointers.find((p) => p.name === head && pointerTrack(tl, b, p).at[i] !== undefined);
  let at = ref ? pointerTrack(tl, b, ref).at[i] : undefined;
  for (const key of rest) at = typeof at === 'number' ? refId(tl.snapshots[i].heap.get(at)?.props?.get(key)?.v) : undefined;
  return at === id;
}

/** How to name the node whose link was written: as the statement does (`curr` in `curr.next = …`), else a pointer holding it, else its value. */
function writerName(tl: Timeline, i: number, b: LinkedListBindings, id: ObjId, key: string): string {
  const stmt = tl.meta.stmts[tl.steps[i]?.sid ?? -1];
  const target = stmt?.assign ? tl.meta.source.slice(stmt.assign.target[0], stmt.assign.target[1]).trim() : '';
  const m = MEMBER.exec(target);
  if (m && m[2] === key) {
    const path = m[1].split('.').map((s) => s.trim());
    if (refersTo(tl, i, b, path, id)) return path.join('.');
  }
  const holder = b.pointers.find((p) => pointerTrack(tl, b, p).at[i] === id);
  return holder ? holder.name : `node ${nodeLabel(tl, tl.snapshots[i], b, id)}`;
}

export function describeList(tl: Timeline, i: number, d: Detection<LinkedListBindings>): string[] {
  const diff = tl.diffs[i];
  const snap = tl.snapshots[i];
  if (i === 0 || !diff || !snap) return [];
  const b = d.bindings;
  const nodes = new Set(b.nodeIds);
  const label = (id: ObjId) => nodeLabel(tl, snap, b, id);
  const text = (v: V | undefined) => {
    const id = refId(v);
    if (id !== null) return nodes.has(id) ? label(id) : previewValue(tl, snap, v, { depth: 0 });
    return nullish(v) ? 'null' : previewValue(tl, snap, v, { depth: 0 });
  };
  const out: string[] = [];
  const created = diff.heap.filter((h) => h.op === 'alloc' && nodes.has(h.id));
  if (created.length) {
    const values = created.map((h) => label(h.id)).filter(Boolean);
    out.push(`new node${created.length > 1 ? 's' : ''}${values.length ? ` ${values.join(', ')}` : ''}`);
  }
  for (const h of diff.heap) {
    const key = String(h.path[0]);
    if (h.op !== 'set' || !nodes.has(h.id) || (key !== b.nextKey && key !== b.prevKey)) continue;
    // a fresh link set to null (`this.next = null`) changes nothing worth a line
    if (h.old === undefined && nullish(h.value)) continue;
    const who = `${writerName(tl, i, b, h.id, key)}.${key}`;
    if (h.old === undefined) out.push(`${who} = ${text(h.value)}`);
    else out.push(sameTarget(h.old, h.value) ? `${who} stays ${text(h.value)}` : `${who}: ${text(h.old)} → ${text(h.value)}`);
  }
  for (const ref of b.pointers) {
    const { at } = pointerTrack(tl, b, ref);
    // a pointer being declared, or vanishing with its returning call, is no move
    if (at[i - 1] === undefined || at[i] === undefined || at[i - 1] === at[i]) continue;
    const line = `${ref.name} moves to ${at[i] === null ? 'null' : label(at[i] as ObjId)}`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}
