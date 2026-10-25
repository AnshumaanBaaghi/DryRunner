/**
 * Grid graphs: a 2D array (an outer array of row arrays) a traversal walks cell by cell — a recursive DFS
 * whose calls take (r, c) and step to neighbor cells, or a BFS / iterative DFS whose frontier holds [r, c]
 * pairs — reading the grid at the cells it moves to (at least MIN_MOVES such moves). Of the 2D arrays the
 * moves read, the grid is the one starting out most varied (a visited array starts uniform). Cells are
 * marked visited in place, in a visited 2D array or in a visited Set (`'r,c'` keys). Not a DP table (an
 * ordered fill: dp2d), not a backtracking board (marks undone after the recursive call) and not a memo
 * (values stored after recursing). A counter going up once per component (`count++` around each outermost
 * call or BFS run) names the components. The frontier is never claimed: the queue / stack views keep it.
 */
import type { TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { valueAt, varKey, type VarRef } from '../../engine/detect/track';
import { keyRepr } from '../../engine/timeline/heap';
import type { HeapChange, Timeline } from '../../engine/timeline/types';
import { deref, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import { fillStats, isDpFill, isIntVar, rowsAt, stepFn, tableVar, varsOf } from '../dp1d/table';
import { tableShape, writeSteps2d, type TableShape } from '../dp2d/detect';
import { buildCallTree } from '../shared/callTree';
import type { DetectContext, Detection } from '../types';
import { isInside } from './cells';
import {
  groupMarks, incrementSteps, liveSteps, markEvents, traversalCallAt, type Component, type GridMarks, type GridSpec, type MarkEvent,
  type MarkKind,
} from './marks';
import { heldArrays, MIN_MOVES, traversals, type Move, type Traversal } from './traversal';

export interface GridGraphBindings extends GridSpec {
  /** r, c of the active call (DFS parameters) or of the cell taken out of the frontier last */
  rowVar?: VarRef;
  colVar?: VarRef;
  marks: GridMarks;
  /** goes up once per component (`count` of islands) */
  counter?: VarRef;
}

export const GRID_GRAPH_SCORE = 0.9;

interface Candidate {
  id: ObjId;
  shape: TableShape;
  /** cell key → steps it was read, ascending */
  reads: Map<string, number[]>;
}

/** 2D arrays read at enough cells to be walked: not a frontier, not a DP fill. */
function candidates(tl: Timeline, a: TraceAnalysis, skip: ReadonlySet<ObjId>): Candidate[] {
  const out: Candidate[] = [];
  for (const o of a.objects.values()) {
    if (o.kind !== 'array' || !o.nested || o.reads < MIN_MOVES || skip.has(o.id)) continue;
    const shape = tableShape(tl, o.id);
    if (shape.rows * shape.cols < MIN_MOVES || isDpFill(fillStats(writeSteps2d(tl, o.id)), MIN_MOVES)) continue;
    const reads = new Map<string, number[]>();
    for (let s = o.allocStep; s < tl.diffs.length; s++) {
      const list = tl.diffs[s].reads;
      if (!list.length) continue;
      const rows = rowsAt(tl, o.id, s);
      for (const e of list) {
        const r = rows.get(e.id);
        if (r === undefined || typeof e.path[0] !== 'number') continue;
        const key = `${r}:${e.path[0]}`;
        const steps = reads.get(key) ?? reads.set(key, []).get(key)!;
        if (steps.at(-1) !== s) steps.push(s);
      }
    }
    if (reads.size >= 2) out.push({ id: o.id, shape, reads });
  }
  return out;
}

/** Some step of an ascending list within [lo, hi]. */
function within(steps: readonly number[], lo: number, hi: number): boolean {
  let a = 0;
  let b = steps.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (steps[mid] < lo) a = mid + 1;
    else b = mid;
  }
  return a < steps.length && steps[a] <= hi;
}

/** Moves into the grid whose target cell was read in one of its windows; `swap` reads (a, b) as (c, r). */
function backed(moves: readonly Move[], g: Candidate, swap: boolean): number {
  let n = 0;
  for (const m of moves) {
    const [r, c] = swap ? [m.to.c, m.to.r] : [m.to.r, m.to.c];
    const steps = isInside(g.shape, r, c) ? g.reads.get(`${r}:${c}`) : undefined;
    if (steps && m.windows.some(([lo, hi]) => within(steps, lo, hi))) n += 1;
  }
  return n;
}

/** Distinct cell values when the traversal starts (a visited array starts uniform, a map does not). */
function variety(tl: Timeline, id: ObjId, s: number): number {
  const snap = tl.snapshots[s];
  const seen = new Set<string>();
  for (const row of snap.heap.get(id)?.elems ?? []) for (const v of deref(snap, row)?.elems ?? []) seen.add(keyRepr(v));
  return seen.size;
}

interface Fit {
  t: Traversal;
  g: Candidate;
  argIdx: [number, number];
  backed: number;
}

/**
 * The grid each traversal walks: of the arrays its moves read, one never written (a visited or distance table
 * is), then the most varied at the start (a visited table starts uniform), then the least written.
 */
function fits(tl: Timeline, a: TraceAnalysis, ts: readonly Traversal[], gs: readonly Candidate[]): Fit[] {
  const writes = (g: Candidate) => g.shape.rowIds.reduce((n, id) => n + (a.objects.get(id)?.ops.set ?? 0), 0);
  const best = new Map<ObjId, Fit>();
  for (const t of ts) {
    const start = t.moves.reduce((s, m) => Math.min(s, m.windows[0][0]), Infinity);
    const options: (Fit & { variety: number; writes: number })[] = [];
    for (const g of gs) {
      const [p, q] = t.kind === 'dfs' ? t.argIdx : [0, 1];
      const straight = backed(t.moves, g, false);
      const swapped = backed(t.moves, g, true);
      const fit: Fit = swapped > straight ? { t, g, argIdx: [q, p], backed: swapped } : { t, g, argIdx: [p, q], backed: straight };
      if (fit.backed >= MIN_MOVES) options.push({ ...fit, variety: variety(tl, g.id, start), writes: writes(g) });
    }
    options.sort((x, y) => Number(x.writes > 0) - Number(y.writes > 0) || y.variety - x.variety || x.writes - y.writes || x.g.id - y.g.id);
    const f = options[0];
    if (f && f.backed > (best.get(f.g.id)?.backed ?? 0)) best.set(f.g.id, { t: f.t, g: f.g, argIdx: f.argIdx, backed: f.backed });
  }
  return [...best.values()];
}

/** Writes a DFS mostly makes after its call recursed store results (a memo), they don't mark visits. */
function storesResults(tl: Timeline, spec: GridSpec, marks: readonly Omit<MarkEvent, 'comp'>[]): boolean {
  if (spec.traversalFn === undefined || !marks.length) return false;
  const tree = buildCallTree(tl, [spec.traversalFn]);
  const post = marks.filter((m) => {
    const first = tree.nodes.get(m.callId ?? -1)?.children[0];
    return first !== undefined && tree.nodes.get(first)!.enterStep < m.step;
  });
  return post.length * 2 > marks.length;
}

interface MarksChoice {
  marks: GridMarks;
  events: Omit<MarkEvent, 'comp'>[];
  /** the grid's own cells hold results stored after recursing: the "grid" is a memo table */
  memo: boolean;
}

/** In place, a visited 2D array shaped like the grid or a visited Set: whichever the traversal marks most. */
function chooseMarks(tl: Timeline, a: TraceAnalysis, spec: GridSpec, skip: ReadonlySet<ObjId>): MarksChoice {
  const options: { kind: MarkKind; id: ObjId }[] = [{ kind: 'inPlace', id: spec.objId }];
  const last = tl.snapshots[tl.snapshots.length - 1];
  const rowWritten = (v: V) => (a.objects.get(refId(v) ?? -1)?.ops.set ?? 0) > 0;
  for (const o of a.objects.values()) {
    if (o.id === spec.objId || skip.has(o.id)) continue;
    if (o.kind === 'set' && (o.ops.setAdd ?? 0) > 0) options.push({ kind: 'set', id: o.id });
    // as many rows as the grid, some of them written (not a constant table like the BFS directions)
    if (o.kind !== 'array' || !o.nested || o.maxLen !== spec.rows || !last.heap.get(o.id)?.elems?.some(rowWritten)) continue;
    const shape = tableShape(tl, o.id);
    if (shape.rows === spec.rows && shape.cols === spec.cols) options.push({ kind: 'array', id: o.id });
  }
  let best: Omit<MarksChoice, 'memo'> = { marks: { kind: 'none' }, events: [] };
  let memo = false;
  for (const { kind, id } of options) {
    const events = markEvents(tl, spec, kind, id);
    if (storesResults(tl, spec, events)) {
      memo ||= kind === 'inPlace';
      continue;
    }
    if (events.length <= best.events.length) continue;
    const ref = kind === 'inPlace' ? undefined : tableVar(a, id, new Set(spec.traversalFn === undefined ? [] : [spec.traversalFn]));
    if (kind !== 'inPlace' && !ref) continue;
    best = { marks: kind === 'inPlace' ? { kind } : { kind, ref, objId: id }, events };
  }
  return { ...best, memo };
}

/** The cell a write targets and what it held before / after (`keyRepr`; a Set's keys are 'in' or 'out'). */
function slotWrite(tl: Timeline, kind: MarkKind, target: ObjId, h: HeapChange, s: number): { slot: string; old: string; now: string } | null {
  if (kind === 'set') {
    if (h.id !== target || (h.op !== 'setAdd' && h.op !== 'setDelete')) return null;
    const add = h.op === 'setAdd';
    return { slot: keyRepr(h.key), old: add ? 'out' : 'in', now: add ? 'in' : 'out' };
  }
  const r = h.op === 'set' && typeof h.path[0] === 'number' ? rowsAt(tl, target, s).get(h.id) : undefined;
  return r === undefined ? null : { slot: `${r}:${h.path[0]}`, old: h.old === undefined ? 'absent' : keyRepr(h.old), now: keyRepr(h.value) };
}

/**
 * Cells a DFS call changed and put back once one of its recursive calls had run (word search's `board[r][c] =
 * '#' … = ch`, a path search unmarking `seen[r][c]`): backtracking. Counts the cells changed and those undone.
 */
function undoneMarks(tl: Timeline, spec: GridSpec, marks: GridMarks): { changed: number; undone: number } {
  const out = { changed: 0, undone: 0 };
  if (spec.traversalFn === undefined || marks.kind === 'none') return out;
  const target = marks.kind === 'inPlace' ? spec.objId : marks.objId!;
  const tree = buildCallTree(tl, [spec.traversalFn]);
  /** `${callId}|${slot}` → what the slot held before the call first changed it (`keyRepr`, 'in' / 'out' of a Set) */
  const before = new Map<string, { old: string; step: number }>();
  for (let s = 0; s < tl.diffs.length; s++) {
    for (const h of tl.diffs[s].heap) {
      const w = slotWrite(tl, marks.kind, target, h, s);
      const callId = w && traversalCallAt(tl, spec.traversalFn, s);
      if (!w || callId === null) continue;
      const { old, now } = w;
      const key = `${callId}|${w.slot}`;
      const first = before.get(key);
      if (!first) {
        if (old === now) continue;
        before.set(key, { old, step: s });
        out.changed += 1;
        continue;
      }
      // put back, with a recursive call made in between
      const recursed = tree.nodes.get(callId)?.children.some((c) => {
        const at = tree.nodes.get(c)!.enterStep;
        return at > first.step && at < s;
      });
      if (now === first.old && recursed) out.undone += 1;
    }
  }
  return out;
}

/** Components that came before an increment (`count++` ahead of each outermost call, or right after it). */
function interleaves(incs: readonly number[], components: readonly Component[]): boolean {
  if (!incs.length || incs.length !== components.length) return false;
  const gaps = incs.map((s) => components.filter((c) => c.end <= s).length);
  if (incs.some((s) => components.some((c) => c.start < s && s < c.end))) return false;
  return gaps.every((g, k) => g === k) || gaps.every((g, k) => g === k + 1);
}

function counterFor(tl: Timeline, a: TraceAnalysis, spec: GridSpec, components: readonly Component[]): VarRef | undefined {
  if (!components.length) return undefined;
  const live = liveSteps(tl, spec);
  const ints = [...a.vars.values()].filter((v) => isIntVar(v) && v.incs > 0 && v.decs === 0 && v.maxJump === 1 && v.ref.fnId !== spec.traversalFn);
  return ints.sort((x, y) => x.firstStep - y.firstStep)
    .find((v) => interleaves(incrementSteps(tl, v.ref).filter((s) => live[s]), components))?.ref;
}

/** Integer variables assigned the popped cell's coordinates as it is taken out (`const [r, c] = queue.shift()`). */
function poppedVar(tl: Timeline, a: TraceAnalysis, t: Extract<Traversal, { kind: 'bfs' }>, k: number): VarRef | undefined {
  let best: { v: VarInfo; hits: number } | undefined;
  for (const v of a.vars.values()) {
    if (!isIntVar(v)) continue;
    const bids = new Set(v.ref.bids);
    const hits = t.pops.filter((p) => tl.diffs[p.step].vars.some((c) => bids.has(c.bid))
      && valueAt(tl, v.ref, p.step) === (k === 0 ? p.r : p.c)).length;
    if (hits * 2 >= t.pops.length && hits > (best?.hits ?? 0)) best = { v, hits };
  }
  return best?.v.ref;
}

function coordVars(tl: Timeline, a: TraceAnalysis, f: Fit): { rowVar?: VarRef; colVar?: VarRef } {
  const { t } = f;
  if (t.kind === 'bfs') {
    // the pops decode pairs as [r, c]; swapped pairs put the row second
    const [rowK, colK] = f.argIdx[0] === 0 ? [0, 1] : [1, 0];
    const rowVar = poppedVar(tl, a, t, rowK);
    const colVar = poppedVar(tl, a, t, colK);
    return { ...(rowVar && { rowVar }), ...(colVar && { colVar }) };
  }
  const params = tl.meta.fns[t.fnId]?.params ?? [];
  const param = (k: number) => a.vars.get(varKey({ name: params[k] ?? '', fnId: t.fnId }))?.ref;
  const rowVar = param(f.argIdx[0]);
  const colVar = param(f.argIdx[1]);
  return { ...(rowVar && { rowVar }), ...(colVar && { colVar }) };
}

const objClaims = (tl: Timeline, a: TraceAnalysis, id: ObjId, rows: boolean) => [
  `obj:${id}`, ...(rows ? tableShape(tl, id).rowIds.map((r) => `obj:${r}`) : []), ...varsOf(a, id).map((v) => varKey(v.ref)),
];

export function detectGridGraph(ctx: DetectContext): Detection<GridGraphBindings>[] {
  const { tl, analysis: a } = ctx;
  const ts = traversals(tl, a);
  if (!ts.length) return [];
  const frontiers = new Set(ts.flatMap((t) => (t.kind === 'bfs' ? heldArrays(tl, t.frontier) : [])));
  const out: Detection<GridGraphBindings>[] = [];
  for (const f of fits(tl, a, ts, candidates(tl, a, frontiers))) {
    const { t, g } = f;
    const fnIds = new Set(t.kind === 'dfs' ? [t.fnId] : [stepFn(tl, t.pops[0].step)]);
    const grid = tableVar(a, g.id, fnIds);
    if (!grid) continue;
    const spec: GridSpec = {
      grid, objId: g.id, rows: g.shape.rows, cols: g.shape.cols, argIdx: f.argIdx,
      ...(t.kind === 'dfs' ? { traversalFn: t.fnId } : { frontier: t.frontier }),
    };
    const { marks, events, memo } = chooseMarks(tl, a, spec, frontiers);
    const { changed, undone } = undoneMarks(tl, spec, marks);
    if (memo || (undone > 0 && undone * 2 >= changed)) continue;
    const { components } = groupMarks(tl, spec, events);
    const counter = counterFor(tl, a, spec, components);
    const visited = marks.kind === 'array' || marks.kind === 'set' ? objClaims(tl, a, marks.objId!, marks.kind === 'array') : [];
    const claims = [...objClaims(tl, a, g.id, true), ...visited, ...(t.kind === 'dfs' ? [`fn:${t.fnId}`] : [])];
    out.push({
      vizId: 'gridGraph',
      key: `gridGraph:obj:${g.id}`,
      title: grid.name,
      score: GRID_GRAPH_SCORE,
      role: 'primary',
      claims: [...new Set(claims)],
      bindings: { ...spec, ...coordVars(tl, a, f), marks, ...(counter && { counter }) },
    });
  }
  return out;
}
