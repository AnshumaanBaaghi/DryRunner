/**
 * What a traversal leaves on its grid: the cells it marks visited — rewritten in place ('1' → '0'), set in a
 * separate visited 2D array or added to a visited Set — each cell's first mark only, made while the traversal
 * runs (inside a DFS call, or right around the step a BFS adds or takes out that cell). A backtracking DFS puts
 * cells back once its recursive calls returned: its marks come and go (`pathEvents`). Marks group into
 * components: the outermost DFS call, or the BFS run, they were made in. Only steps where the grid variable
 * holds this grid count (`live`), so a second run on another grid leaves this one alone. Pure.
 */
import { valueAt, varKey, type VarRef } from '../../engine/detect/track';
import { keyRepr } from '../../engine/timeline/heap';
import type { Timeline } from '../../engine/timeline/types';
import { deref, refId } from '../../engine/timeline/values';
import { sameV, type ObjId, type V } from '../../engine/types/values';
import { ownerCall } from '../backtracking/choices';
import { cached, cellKey, rowsAt, type Cache } from '../dp1d/table';
import { buildCallTree } from '../shared/callTree';
import { isInside, isWaterValue, keyCell, type Cell, type Shape } from './cells';
import { frontierRun, heldArrays, type FrontierRun } from './traversal';

/** inPlace: grid cells rewritten · array: a visited 2D array · set: a Set of `'r,c'` / `r * cols + c` keys */
export type MarkKind = 'inPlace' | 'array' | 'set' | 'none';

export interface GridMarks {
  kind: MarkKind;
  /** the separate visited structure */
  ref?: VarRef;
  objId?: ObjId;
}

/** The grid and its traversal (the part of the bindings the facts below depend on). */
export interface GridSpec extends Shape {
  grid: VarRef;
  /** the outer array */
  objId: ObjId;
  /** recursive DFS whose calls take (r, c) */
  traversalFn?: number;
  /** BFS / iterative DFS: the variable holding the [r, c] pairs */
  frontier?: VarRef;
  /** positions of (r, c): in the traversal calls' arguments (DFS) or in the frontier's pairs (BFS) */
  argIdx: [number, number];
}

export type MarkVerb = 'sink' | 'fill' | 'visit';

export interface MarkEvent extends Cell {
  step: number;
  verb: MarkVerb;
  /** the grid value the cell had when it was marked */
  was: V | undefined;
  /** DFS: the traversal call that made the mark */
  callId?: number;
  /** component index (0-based) */
  comp: number;
}

export interface Component {
  start: number;
  end: number;
}

/** A cell put back as it was before its mark: a backtracking DFS backing out of it. */
export interface UnmarkEvent extends Cell {
  step: number;
  callId: number;
}

export interface PathEvents {
  /** every mark, a cell marked again after it was put back included */
  marks: Omit<MarkEvent, 'comp'>[];
  unmarks: UnmarkEvent[];
}

/** steps around adding / taking out a cell within which a BFS write to it is its mark */
const SLACK = 4;

const liveCache: Cache<boolean[]> = new WeakMap();

/** Steps where the grid variable holds this grid. */
export function liveSteps(tl: Timeline, spec: GridSpec): boolean[] {
  return cached(liveCache, tl, `${varKey(spec.grid)}:${spec.objId}`, () =>
    tl.steps.map((_, s) => refId(valueAt(tl, spec.grid, s)) === spec.objId));
}

/** The traversal call (nearest call of `fnId` at or above the frame) whose code ran step s. */
export function traversalCallAt(tl: Timeline, fnId: number, s: number): number | null {
  for (let c = tl.calls.get(ownerCall(tl, s)); c; c = tl.calls.get(c.parentId)) if (c.fnId === fnId) return c.callId;
  return null;
}

/** BFS: the steps each cell was added to or taken out of the frontier. */
function frontierSteps(run: FrontierRun): Map<string, { added: number[]; taken: number[] }> {
  const out = new Map<string, { added: number[]; taken: number[] }>();
  const at = (c: Cell) => out.get(cellKey(c)) ?? out.set(cellKey(c), { added: [], taken: [] }).get(cellKey(c))!;
  for (const e of run.pushes) at(e).added.push(e.step);
  for (const e of run.pops) at(e).taken.push(e.step);
  return out;
}

export function runOfSpec(tl: Timeline, spec: GridSpec): FrontierRun | null {
  return spec.frontier ? frontierRun(tl, heldArrays(tl, spec.frontier), spec.argIdx) : null;
}

interface Write extends Cell {
  step: number;
  old?: V;
  value?: V;
}

/** Writes changing cells of the target: `set`s on rows of a 2D array, `add`s to (value true) and `delete`s from a Set. */
function targetWrites(tl: Timeline, spec: GridSpec, kind: MarkKind, id: ObjId): Write[] {
  const out: Write[] = [];
  for (let s = 0; s < tl.diffs.length; s++) {
    const heap = tl.diffs[s].heap;
    if (!heap.length) continue;
    for (const h of heap) {
      if (kind === 'set') {
        const cell = (h.op === 'setAdd' || h.op === 'setDelete') && h.id === id ? keyCell(tl, h.key, spec.cols) : null;
        if (cell && isInside(spec, cell.r, cell.c)) out.push({ ...cell, step: s, value: h.op === 'setAdd' });
        continue;
      }
      if (h.op !== 'set' || typeof h.path[0] !== 'number' || (h.old !== undefined && sameV(h.old, h.value))) continue;
      const r = rowsAt(tl, id, s).get(h.id);
      if (r !== undefined) out.push({ r, c: h.path[0], step: s, old: h.old, value: h.value });
    }
  }
  return out;
}

/** The grid's value at a cell at step s. */
function gridValue(tl: Timeline, spec: GridSpec, cell: Cell, s: number): V | undefined {
  const snap = tl.snapshots[s];
  return deref(snap, snap.heap.get(spec.objId)?.elems?.get(cell.r))?.elems?.get(cell.c);
}

const near = (steps: number[] | undefined, s: number, before: number, after: number) => steps?.some((x) => s - x <= after && x - s <= before) ?? false;

/** First marks per cell made by the traversal on a target (in place: the grid itself), in step order. */
export function markEvents(tl: Timeline, spec: GridSpec, kind: MarkKind, id: ObjId): Omit<MarkEvent, 'comp'>[] {
  if (kind === 'none') return [];
  const live = liveSteps(tl, spec);
  const run = runOfSpec(tl, spec);
  const steps = run ? frontierSteps(run) : null;
  const out: Omit<MarkEvent, 'comp'>[] = [];
  const seen = new Set<string>();
  for (const w of targetWrites(tl, spec, kind, id)) {
    if (!live[w.step] || seen.has(cellKey(w)) || (kind === 'set' && w.value === false)) continue;
    let callId: number | undefined;
    if (spec.traversalFn !== undefined) {
      callId = traversalCallAt(tl, spec.traversalFn, w.step) ?? undefined;
      if (callId === undefined) continue;
    } else {
      const at = steps?.get(cellKey(w));
      if (!near(at?.added, w.step, SLACK, SLACK) && !near(at?.taken, w.step, 0, SLACK)) continue;
    }
    seen.add(cellKey(w));
    const verb: MarkVerb = kind !== 'inPlace' ? 'visit' : isWaterValue(w.value) ? 'sink' : 'fill';
    const was = kind === 'inPlace' ? w.old : gridValue(tl, spec, w, w.step);
    out.push({ r: w.r, c: w.c, step: w.step, verb, was, ...(callId !== undefined && { callId }) });
  }
  return out;
}

/**
 * A backtracking DFS's marks as they come and go, in step order: each mark (a cell marked again once put back
 * included) and each unmark, the cell put back as it was before its mark (`grid[r][c] = 2 … = 0`,
 * `seen[r][c] = false`, `seen.delete(key)`).
 */
export function pathEvents(tl: Timeline, spec: GridSpec, kind: MarkKind, id: ObjId): PathEvents {
  const out: PathEvents = { marks: [], unmarks: [] };
  if (kind === 'none' || spec.traversalFn === undefined) return out;
  const live = liveSteps(tl, spec);
  /** cells marked now → what they held before the mark (`keyRepr`; a Set's keys are 'in' or 'out') */
  const held = new Map<string, string>();
  for (const w of targetWrites(tl, spec, kind, id)) {
    const callId = live[w.step] ? traversalCallAt(tl, spec.traversalFn, w.step) : null;
    if (callId === null) continue;
    const key = cellKey(w);
    const now = kind === 'set' ? (w.value ? 'in' : 'out') : keyRepr(w.value);
    const rest = held.get(key);
    if (rest === undefined) {
      const before = kind === 'set' ? 'out' : w.old === undefined ? 'absent' : keyRepr(w.old);
      if (now === before) continue;
      held.set(key, before);
      const was = kind === 'inPlace' ? w.old : gridValue(tl, spec, w, w.step);
      out.marks.push({ r: w.r, c: w.c, step: w.step, verb: 'visit', was, callId });
    } else if (now === rest) {
      held.delete(key);
      out.unmarks.push({ r: w.r, c: w.c, step: w.step, callId });
    }
  }
  return out;
}

/** Groups marks by the outermost DFS call or the BFS run they were made in (runs end with their loop). */
export function groupMarks(tl: Timeline, spec: GridSpec, raw: readonly Omit<MarkEvent, 'comp'>[]): { marks: MarkEvent[]; components: Component[] } {
  const components: Component[] = [];
  const marks: MarkEvent[] = [];
  const last = tl.steps.length;
  if (spec.traversalFn !== undefined) {
    const tree = buildCallTree(tl, [spec.traversalFn]);
    const index = new Map<number, number>();
    for (const m of raw) {
      let node = tree.nodes.get(m.callId ?? -1);
      while (node && node.parent !== null) node = tree.nodes.get(node.parent);
      if (!node) continue;
      if (!index.has(node.callId)) {
        index.set(node.callId, components.length);
        components.push({ start: node.enterStep, end: node.exitStep ?? last });
      }
      marks.push({ ...m, comp: index.get(node.callId)! });
    }
    return { marks, components };
  }
  const runs = [...new Map((runOfSpec(tl, spec)?.pops ?? []).map((p) => [p.start, { start: p.start, end: p.end }])).values()];
  const used = new Map<number, number>();
  for (const m of raw) {
    // a run's first cell is often marked just before its loop starts: the first run not over yet
    const k = runs.findIndex((x) => x.end >= m.step);
    const key = k < 0 ? runs.length : k;
    if (!used.has(key)) {
      used.set(key, components.length);
      const run = runs[key] ?? { start: m.step, end: last };
      components.push({ start: Math.min(run.start, m.step), end: run.end });
    }
    marks.push({ ...m, comp: used.get(key)! });
  }
  return { marks, components };
}

/** Steps where an integer variable went up by one. */
export function incrementSteps(tl: Timeline, ref: VarRef): number[] {
  const bids = new Set(ref.bids);
  const out: number[] = [];
  tl.diffs.forEach((d, s) => {
    if (d.vars.some((c) => bids.has(c.bid) && c.kind === 'changed' && typeof c.old === 'number' && c.value === c.old + 1)) out.push(s);
  });
  return out;
}
