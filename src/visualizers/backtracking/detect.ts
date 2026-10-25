/**
 * Backtracking: a recursive function whose calls make a choice right before a recursive call and undo it
 * right after the call returns. Modes by what is chosen: board (a cell of a 2D array set and restored,
 * e.g. N-Queens), path (a list pushed before and popped after) or flags (entries set and reset:
 * `used[i]`, a visited Set). Results: a collection that exists before the recursion starts and receives
 * copies (fresh arrays) or strings from inside it.
 */
import type { TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { varKey, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { isObj, refId } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import { buildCallTree, type CallTree } from '../shared/callTree';
import type { DetectContext, Detection } from '../types';
import { choiceWindows, ownerCall, pendingPush, revertedWrites, shrinks, treeCallOf } from './choices';

export type BacktrackMode = 'path' | 'board' | 'flags';

export interface BacktrackBindings {
  fnIds: number[];
  mode: BacktrackMode;
  path?: VarRef;
  board?: VarRef;
  flags?: VarRef;
  results?: VarRef;
}

export const BACKTRACK_SCORE = 0.95;

const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);

/** The id with the most choose / undo pairs (first seen wins ties). */
function best(m: Map<number, number>, skip: ReadonlySet<number> = new Set()): number | null {
  let out: number | null = null;
  for (const [id, n] of m) if (!skip.has(id) && (out === null || n > m.get(out)!)) out = id;
  return out;
}

/** The 2D array (outer array of arrays) holding row `rowId` at step `s`, if any. */
function outerOf(tl: Timeline, a: TraceAnalysis, rowId: number, s: number): number | null {
  for (const o of a.objects.values()) {
    if (!o.nested || o.kind !== 'array') continue;
    if (tl.snapshots[s].heap.get(o.id)?.elems?.some((e) => refId(e) === rowId)) return o.id;
  }
  return null;
}

interface Tally {
  path: Map<number, number>;
  board: Map<number, number>;
  flags: Map<number, number>;
}

function tally(tl: Timeline, a: TraceAnalysis, tree: CallTree): Tally {
  const t: Tally = { path: new Map(), board: new Map(), flags: new Map() };
  const rows = new Map<number, number | null>();
  for (const w of choiceWindows(tl, tree)) {
    const pushed = new Set(w.before.filter((c) => c.h.op === 'push').map((c) => c.h.id));
    for (const id of pushed) {
      const o = a.objects.get(id);
      if (o?.kind !== 'array' || o.nested) continue;
      if (pendingPush(w, id) && w.after.some((c) => c.h.id === id && shrinks(c.h))) bump(t.path, id);
    }
    for (const { choose } of revertedWrites(w)) {
      const id = choose.h.id;
      if (!rows.has(id)) rows.set(id, choose.h.op === 'set' ? outerOf(tl, a, id, choose.step) : null);
      const outer = rows.get(id)!;
      bump(outer === null ? t.flags : t.board, outer ?? id);
    }
  }
  return t;
}

/** The variable that best stands for an object: only ever this object, declared outside the recursion, earliest. */
function varFor(a: TraceAnalysis, objId: number | null, fnId: number): VarRef | undefined {
  const o = objId === null ? undefined : a.objects.get(objId);
  if (!o) return undefined;
  const vars = [...o.varKeys].map((k) => a.vars.get(k)).filter((v): v is VarInfo => v !== undefined && !v.kinds.has('fn'));
  vars.sort((x, y) => Number(x.heapIds.size !== 1) - Number(y.heapIds.size !== 1)
    || Number(x.ref.fnId === fnId) - Number(y.ref.fnId === fnId) || x.firstStep - y.firstStep);
  return vars[0]?.ref;
}

const isString = (v: V | undefined) => typeof v === 'string' || (isObj(v) && 's' in v);

/** The array collecting solutions: exists before the first call, never shrinks, gets copies / strings pushed inside calls. */
function resultsOf(tl: Timeline, a: TraceAnalysis, tree: CallTree, skip: ReadonlySet<number>): number | null {
  const start = Math.min(...tree.roots.map((r) => tree.nodes.get(r)!.enterStep));
  const counts = new Map<number, number>();
  for (let s = 0; s < tl.diffs.length; s++) {
    for (const h of tl.diffs[s].heap) {
      if (h.op !== 'push' || skip.has(h.id)) continue;
      const o = a.objects.get(h.id);
      if (o?.kind !== 'array' || o.allocStep >= start || (o.ops.pop ?? 0) + (o.ops.shift ?? 0) + (o.ops.splice ?? 0) > 0) continue;
      const owner = treeCallOf(tl, tree, ownerCall(tl, s));
      if (owner === null) continue;
      const v = h.args?.[0];
      const id = refId(v);
      const fresh = id !== null ? (a.objects.get(id)?.allocStep ?? -1) >= tree.nodes.get(owner)!.enterStep : isString(v);
      if (fresh) bump(counts, h.id);
    }
  }
  return best(counts);
}

function claimsOf(a: TraceAnalysis, ref: VarRef | undefined): string[] {
  if (!ref) return [];
  return [varKey(ref), ...[...(a.vars.get(varKey(ref))?.heapIds ?? [])].map((id) => `obj:${id}`)];
}

/** Row arrays of a board (claimed with it: the board draws them). */
function rowClaims(tl: Timeline, boardId: number | null): string[] {
  if (boardId === null) return [];
  const last = tl.snapshots[tl.snapshots.length - 1];
  return (last.heap.get(boardId)?.elems?.toArray() ?? []).map(refId).filter((id) => id !== null).map((id) => `obj:${id}`);
}

export function detectBacktracking(ctx: DetectContext): Detection<BacktrackBindings>[] {
  const { tl, analysis: a } = ctx;
  const out: Detection<BacktrackBindings>[] = [];
  for (const fnId of a.recursiveFns) {
    const tree = buildCallTree(tl, [fnId]);
    if (!tree.roots.length) continue;
    const t = tally(tl, a, tree);
    const boardId = best(t.board);
    const pathId = best(t.path);
    const board = varFor(a, boardId, fnId);
    const path = board ? undefined : varFor(a, pathId, fnId);
    const flagsId = best(t.flags, new Set(pathId === null ? [] : [pathId]));
    const flags = varFor(a, flagsId, fnId);
    const mode: BacktrackMode | null = board ? 'board' : path ? 'path' : flags ? 'flags' : null;
    if (!mode) continue;
    const used = new Set([boardId, pathId, flagsId].filter((id) => id !== null));
    const results = varFor(a, resultsOf(tl, a, tree, used), fnId);
    const claims = [
      `fn:${fnId}`, ...claimsOf(a, board), ...(board ? rowClaims(tl, boardId) : []), ...claimsOf(a, path), ...claimsOf(a, flags),
      ...claimsOf(a, results),
    ];
    out.push({
      vizId: 'backtracking',
      key: `backtracking:${fnId}`,
      title: tl.meta.fns[fnId]?.name || 'backtracking',
      score: BACKTRACK_SCORE,
      role: 'primary',
      mode,
      claims: [...new Set(claims)],
      bindings: { fnIds: [fnId], mode, ...(path && { path }), ...(board && { board }), ...(flags && { flags }), ...(results && { results }) },
    });
  }
  return out;
}
