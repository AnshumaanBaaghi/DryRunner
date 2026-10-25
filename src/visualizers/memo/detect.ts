/**
 * Memoized recursion: a recursive function and a cache — a Map, a plain object, an array or a 2D table —
 * that its calls look up before recursing and store their results in once their recursive calls
 * returned, with at least one later call returning an entry an earlier call stored without recursing
 * (a cache hit). Replaces the plain recursion tree for that function.
 */
import type { TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import type { HeapKind, ObjId } from '../../engine/types/values';
import { buildCallTree, type CallTree } from '../shared/callTree';
import type { DetectContext, Detection } from '../types';
import { cacheAccesses, memoCalls, tableRows, writtenByTree, type CacheKind, type CacheSet } from './access';

export interface MemoBindings {
  fnIds: number[];
  /** the variable naming the cache */
  cache: VarRef;
  /** how entries are keyed: Map keys, properties, array indices or `row,col` of a 2D table */
  kind: CacheKind;
}

export const MEMO_SCORE = 0.95;

/** Row arrays of the 2D arrays in the trace → their outer array. */
function rowOwners(tl: Timeline, a: TraceAnalysis): Map<ObjId, ObjId> {
  const nested = [...a.objects.values()].filter((o) => o.kind === 'array' && o.nested).map((o) => o.id);
  const out = new Map<ObjId, ObjId>();
  for (const [row, { outer }] of tableRows(tl, nested)) if (a.objects.get(row)?.kind === 'array') out.set(row, outer);
  return out;
}

function cacheSetOf(kind: HeapKind | undefined, id: ObjId, outer: ObjId | undefined): CacheSet | null {
  if (kind === 'map' || kind === 'object') return { kind, ids: new Set([id]) };
  if (kind !== 'array') return null;
  return outer === undefined ? { kind: 'array', ids: new Set([id]) } : { kind: 'table', ids: new Set([outer]) };
}

/** Caches the tree's calls write entries of: Maps, objects, flat arrays, and the tables whose rows they write. */
function candidates(tl: Timeline, a: TraceAnalysis, tree: CallTree, owners: Map<ObjId, ObjId>): CacheSet[] {
  const out = new Map<string, CacheSet>();
  for (const id of writtenByTree(tl, tree)) {
    const set = cacheSetOf(a.objects.get(id)?.kind, id, owners.get(id));
    if (set) out.set(`${set.kind}:${[...set.ids][0]}`, set);
  }
  return [...out.values()];
}

/** The variable that best names the cache: only ever this object, declared outside the recursion, earliest. */
function varFor(a: TraceAnalysis, objId: ObjId, fnId: number): VarRef | undefined {
  const vars = [...(a.objects.get(objId)?.varKeys ?? [])].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
  vars.sort((x, y) => Number(x.heapIds.size !== 1) - Number(y.heapIds.size !== 1)
    || Number(x.ref.fnId === fnId) - Number(y.ref.fnId === fnId) || x.firstStep - y.firstStep);
  return vars[0]?.ref;
}

interface Found {
  fnId: number;
  set: CacheSet;
  cache: VarRef;
  reuses: number;
}

/** The function's cache with the most reused entries (a cache holds at least two stored entries). */
function bestCache(tl: Timeline, a: TraceAnalysis, fnId: number, owners: Map<ObjId, ObjId>): Found | null {
  const tree = buildCallTree(tl, [fnId]);
  if (!tree.roots.length) return null;
  let best: Found | null = null;
  for (const set of candidates(tl, a, tree, owners)) {
    const { reuses, storedKeys } = memoCalls(tree, cacheAccesses(tl, tree, set));
    if (!reuses || storedKeys < 2 || (best && reuses <= best.reuses)) continue;
    const cache = varFor(a, [...set.ids][0], fnId);
    if (cache) best = { fnId, set, cache, reuses };
  }
  return best;
}

/** The function, the cache objects (with a table's rows) and every variable naming them. */
function claimsOf(tl: Timeline, a: TraceAnalysis, f: Found): string[] {
  const ids = new Set([...f.set.ids, ...(a.vars.get(varKey(f.cache))?.heapIds ?? [])]);
  const rows = f.set.kind === 'table' ? [...tableRows(tl, ids).keys()] : [];
  const vars = [...ids].flatMap((id) => [...(a.objects.get(id)?.varKeys ?? [])]);
  return [...new Set([`fn:${f.fnId}`, ...[...ids, ...rows].map((id) => `obj:${id}`), varKey(f.cache), ...vars])];
}

export function detectMemo(ctx: DetectContext): Detection<MemoBindings>[] {
  const { tl, analysis: a } = ctx;
  const owners = rowOwners(tl, a);
  const byCache = new Map<ObjId, Found>();
  for (const fnId of a.recursiveFns) {
    const f = bestCache(tl, a, fnId, owners);
    if (!f) continue;
    // one recursion per cache (e.g. a memoizing wrapper and the function it wraps): the one reusing it most
    const id = [...f.set.ids][0];
    const other = byCache.get(id);
    if (!other || f.reuses > other.reuses) byCache.set(id, f);
  }
  return [...byCache.values()].map((f): Detection<MemoBindings> => ({
    vizId: 'memo',
    key: `memo:${f.fnId}`,
    title: tl.meta.fns[f.fnId]?.name || 'memo',
    score: MEMO_SCORE,
    role: 'primary',
    claims: claimsOf(tl, a, f),
    bindings: { fnIds: [f.fnId], cache: f.cache, kind: f.set.kind },
  }));
}
