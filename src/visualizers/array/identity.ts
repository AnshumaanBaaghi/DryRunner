/**
 * Element identities through the trace so bars physically move: swaps exchange identities, sort/reverse
 * apply their permutation, shift/unshift/splice move them; plain writes keep the slot's identity.
 * Stored sparsely: only at steps where the order changes.
 */
import type { Timeline } from '../../engine/timeline/types';
import type { ObjId } from '../../engine/types/values';

interface IdTimeline {
  length: number;
  steps: number[];
  ids: number[][];
}

const cache = new WeakMap<Timeline, Map<ObjId, IdTimeline>>();

function build(tl: Timeline, objId: ObjId, from?: IdTimeline): IdTimeline {
  const steps = from ? [...from.steps] : [];
  const ids = from ? [...from.ids] : [];
  let next = 0;
  let cur: number[] | null = ids.length ? [...ids[ids.length - 1]] : null;
  if (cur) next = Math.max(-1, ...cur) + 1;
  const start = from ? from.length : 0;
  for (let i = start; i < tl.steps.length; i++) {
    const d = tl.diffs[i];
    let changed = false;
    const sets: { idx: number; old: unknown; value: unknown }[] = [];
    for (const h of d.heap) {
      if (h.id !== objId) continue;
      if (h.op === 'alloc') {
        const n = tl.snapshots[i].heap.get(objId)?.elems?.size ?? 0;
        cur = Array.from({ length: n }, () => next++);
        changed = true;
        continue;
      }
      if (!cur) continue;
      switch (h.op) {
        case 'push':
          for (let k = 0; k < (h.args?.length ?? 0); k++) cur.push(next++);
          changed = true;
          break;
        case 'pop':
          cur.pop();
          changed = true;
          break;
        case 'shift':
          cur.shift();
          changed = true;
          break;
        case 'unshift':
          cur.unshift(...Array.from({ length: h.args?.length ?? 0 }, () => next++));
          changed = true;
          break;
        case 'splice': {
          const start0 = typeof h.path[0] === 'number' ? h.path[0] : 0;
          cur.splice(start0, h.removed?.length ?? 0, ...Array.from({ length: h.args?.length ?? 0 }, () => next++));
          changed = true;
          break;
        }
        case 'sort':
        case 'reverse':
          if (h.perm) {
            const before = cur;
            cur = h.perm.map((p) => before[p] ?? next++);
            changed = true;
          }
          break;
        case 'length': {
          const n = h.length ?? cur.length;
          while (cur.length > n) cur.pop();
          while (cur.length < n) cur.push(next++);
          changed = true;
          break;
        }
        case 'set':
          if (typeof h.path[0] === 'number') {
            sets.push({ idx: h.path[0], old: JSON.stringify(h.old), value: JSON.stringify(h.value) });
            while (cur.length <= h.path[0]) {
              cur.push(next++);
              changed = true;
            }
          }
          break;
      }
    }
    // a write that moves another slot's old value here (swap, or a partition move) carries that identity
    if (cur && sets.length >= 2) {
      const before = [...cur];
      for (const s of sets) {
        const src = sets.find((o) => o !== s && o.old === s.value);
        if (src) {
          cur[s.idx] = before[src.idx];
          changed = true;
        }
      }
    }
    if (changed && cur) {
      steps.push(i);
      ids.push([...cur]);
    }
  }
  return { length: tl.steps.length, steps, ids };
}

/** Identity of each slot of array `objId` at step `i` (null before the array exists). */
export function idsAt(tl: Timeline, objId: ObjId, i: number): number[] | null {
  let byObj = cache.get(tl);
  if (!byObj) {
    byObj = new Map();
    cache.set(tl, byObj);
  }
  let t = byObj.get(objId);
  if (!t || t.length !== tl.steps.length) {
    t = build(tl, objId, t);
    byObj.set(objId, t);
  }
  let lo = 0;
  let hi = t.steps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t.steps[mid] <= i) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : t.ids[found];
}
