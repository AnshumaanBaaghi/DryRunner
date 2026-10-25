/**
 * Hash maps and sets: a Map or Set the code modifies after creating it (set / add / delete / clear) or
 * looks keys up in at least twice, or a plain object used with dynamic keys (property writes with at
 * least two distinct keys after the step that allocated it). Lookup literals never written after their
 * creation, class instances (list / tree nodes) and arrays stay out. One detection per object, named by
 * the variable that best names it.
 */
import type { ObjInfo, TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import type { HeapKind, ObjId } from '../../engine/types/values';
import type { DetectContext, Detection } from '../types';

export type HashKind = 'map' | 'set' | 'object';

export interface HashMapBindings {
  /** the variable naming the map (the view follows it to the object of this kind it names at each step) */
  target: VarRef;
  objId: ObjId;
  kind: HashKind;
}

export const HASHMAP_SCORE = 0.7;

const COLLECTION_OPS = ['mapSet', 'mapDelete', 'mapClear', 'setAdd', 'setDelete', 'setClear'];

/** Maps, Sets and plain (class-less) objects; null for anything else. */
export function hashKindOf(kind: HeapKind | undefined, cls: string | undefined): HashKind | null {
  if (kind === 'map' || kind === 'set') return kind;
  return kind === 'object' && !cls ? 'object' : null;
}

/** Plain object → the distinct property keys written (set or deleted) after its allocation step. */
function writtenKeys(tl: Timeline, a: TraceAnalysis): Map<ObjId, Set<string>> {
  const out = new Map<ObjId, Set<string>>();
  tl.diffs.forEach((d, s) => {
    for (const h of d.heap) {
      if ((h.op !== 'set' && h.op !== 'delete') || h.path.length !== 1) continue;
      const o = a.objects.get(h.id);
      if (!o || hashKindOf(o.kind, o.cls) !== 'object' || s <= o.allocStep) continue;
      let keys = out.get(h.id);
      if (!keys) out.set(h.id, (keys = new Set()));
      keys.add(String(h.path[0]));
    }
  });
  return out;
}

function inUse(o: ObjInfo, kind: HashKind, keys: Map<ObjId, Set<string>>): boolean {
  if (kind === 'object') return (keys.get(o.id)?.size ?? 0) >= 2;
  return COLLECTION_OPS.some((op) => (o.ops[op] ?? 0) > 0) || o.reads >= 2;
}

/** Variables naming the object, best first: the ones only ever naming it, then the earliest declared. */
function namers(a: TraceAnalysis, o: ObjInfo): VarInfo[] {
  const vars = [...o.varKeys].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
  return vars.sort((x, y) => Number(x.heapIds.size !== 1) - Number(y.heapIds.size !== 1) || x.firstStep - y.firstStep);
}

export function detectHashMaps(ctx: DetectContext): Detection<HashMapBindings>[] {
  const { tl, analysis: a } = ctx;
  const keys = writtenKeys(tl, a);
  const out: Detection<HashMapBindings>[] = [];
  for (const o of a.objects.values()) {
    const kind = hashKindOf(o.kind, o.cls);
    if (!kind || !inUse(o, kind, keys)) continue;
    const [best, ...rest] = namers(a, o);
    if (!best) continue;
    // a helper's parameter that names other maps too stays unclaimed, so those maps stay visible
    const own = rest.filter((v) => v.heapIds.size === 1).map((v) => varKey(v.ref));
    out.push({
      vizId: 'hashMap',
      key: `hashMap:${o.id}`,
      title: best.ref.name,
      score: HASHMAP_SCORE,
      role: 'aux',
      side: 'left',
      claims: [`obj:${o.id}`, varKey(best.ref), ...own],
      bindings: { target: best.ref, objId: o.id, kind },
    });
  }
  return out;
}
