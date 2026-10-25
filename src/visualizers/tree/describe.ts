/**
 * HUD lines for a tree: nodes created, links written (`insert 4 as right child of 3`), where a traversal
 * call goes (`go left of 8`, `go right of 1: null`), values pushed to the visit order (`visit 6`, then the
 * order so far) and pointers moving (`curr goes left of 8`).
 */
import type { CallNode, Timeline } from '../../engine/timeline/types';
import { previewValue } from '../../engine/timeline/values';
import type { ObjId } from '../../engine/types/values';
import type { Detection } from '../types';
import type { TreeBindings } from './detect';
import { pointerTrack } from './pointers';
import { childrenAt, isBinary, linkChanges, nodeLabel } from './structure';
import { isNodeCtor, nodeArg, parentCall, readSlot, walkFacts, type WalkFacts } from './walk';

/** visit-order values listed at most (the latest ones) */
const OUTPUT_TAIL = 12;

/** Where a traversal call entered at step i goes, relative to the node of the call it came from. */
function callLine(tl: Timeline, i: number, b: TreeBindings, facts: WalkFacts, call: CallNode, label: (id: ObjId) => string): string {
  const node = nodeArg(call, facts.pos, facts.nodes);
  const up = parentCall(tl, facts.fns, call);
  const parent = up ? nodeArg(up, facts.pos, facts.nodes) : null;
  if (!up) return node === null ? 'start: empty tree' : `start at ${label(node)}`;
  if (parent === null) return node === null ? 'reach null' : `go to ${label(node)}`;
  if (node === null) {
    const slot = readSlot(tl, i, b, parent, null);
    return slot === null ? `reach null under ${label(parent)}` : `go ${b.childKeys[slot]} of ${label(parent)}: null`;
  }
  const slot = childrenAt(tl.snapshots[i], b, parent, facts.nodes).indexOf(node);
  if (slot < 0) return `go to ${label(node)}`;
  return isBinary(b) ? `go ${b.childKeys[slot]} of ${label(parent)}` : `go to child ${label(node)} of ${label(parent)}`;
}

export function describeTree(tl: Timeline, i: number, d: Detection<TreeBindings>): string[] {
  const diff = tl.diffs[i];
  const snap = tl.snapshots[i];
  const step = tl.steps[i];
  if (i === 0 || !diff || !snap || !step) return [];
  const b = d.bindings;
  const facts = walkFacts(tl, b);
  const label = (id: ObjId) => nodeLabel(tl, snap, b, id) || 'node';
  const text = (id: ObjId | null) => (id === null ? 'null' : label(id));
  const out: string[] = [];

  const created = diff.heap.filter((h) => h.op === 'alloc' && facts.nodes.has(h.id)).map((h) => nodeLabel(tl, snap, b, h.id));
  if (created.length) out.push(`new node${created.length > 1 ? 's' : ''}${created.some(Boolean) ? ` ${created.filter(Boolean).join(', ')}` : ''}`);

  const fnId = tl.calls.get(step.callId)?.fnId ?? -1;
  // the node class's constructor attaches the children it was given; elsewhere a new child is an insertion
  const verb = !isBinary(b) ? 'add' : isNodeCtor(tl, fnId, b.nodeShape) ? 'attach' : 'insert';
  for (const c of linkChanges(snap, diff.heap, b, facts.nodes)) {
    const role = isBinary(b) ? `${b.childKeys[c.slot]} child` : 'child';
    if (c.was === null && c.now !== null) out.push(`${verb} ${label(c.now)} as ${role} of ${label(c.parent)}`);
    else if (isBinary(b)) out.push(`${label(c.parent)}.${b.childKeys[c.slot]}: ${text(c.was)} → ${text(c.now)}`);
    else if (c.was !== null) out.push(`remove child ${label(c.was)} of ${label(c.parent)}`);
  }

  const call = step.kind === 'call' ? tl.calls.get(step.callId) : undefined;
  if (call && facts.fns.has(call.fnId)) out.push(callLine(tl, i, b, facts, call, label));

  for (const o of facts.outputs) {
    const pushes = o.pushes.filter((p) => p.step === i);
    if (!pushes.length) continue;
    for (const p of pushes) if (p.node !== null) out.push(`visit ${label(p.node)}`);
    const elems = snap.heap.get(o.id)?.elems?.toArray() ?? [];
    const tail = elems.slice(-OUTPUT_TAIL).map((v) => previewValue(tl, snap, v, { depth: 0, maxString: 8 }));
    out.push(`output ${elems.length > OUTPUT_TAIL ? '…, ' : ''}${tail.join(', ')}`);
  }

  for (const ref of b.pointers) {
    // a traversal function's variables follow its calls (told above); others move when assigned
    if (facts.fns.has(ref.fnId) || !diff.vars.some((c) => ref.bids.includes(c.bid))) continue;
    const { at } = pointerTrack(tl, b, ref);
    const was = at[i - 1];
    const now = at[i];
    // a pointer being declared is no move
    if (was === undefined || now === undefined || was === now) continue;
    // stepping down a child link (`curr = curr.left`) rather than jumping somewhere (`node = queue.shift()`)
    const slot = was === null ? null : readSlot(tl, i, b, was, now);
    const line = slot === null || was === null ? `${ref.name} moves to ${text(now)}`
      : `${ref.name} goes ${b.childKeys[slot]} of ${label(was)}${now === null ? ': null' : ''}`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}
