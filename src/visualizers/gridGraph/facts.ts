/**
 * Per-step facts of a grid-graph detection, shared by the view model and the HUD lines: the visited marks and
 * their components (cached per timeline), the current cell (the active DFS call's (r, c), or the cell taken out
 * of the frontier last while its BFS run lasts), the cells probed in a step — read on the grid or the visited
 * structure, or stepped onto off the grid by a DFS call — and the cells waiting: the DFS calls on the stack
 * below the current one, or the pairs still in the frontier. Pure.
 */
import { valueAt, varKey } from '../../engine/detect/track';
import { keyRepr } from '../../engine/timeline/heap';
import type { Timeline } from '../../engine/timeline/types';
import { deref } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import { cached, cellKey, type Cache } from '../dp1d/table';
import { activeNode, buildCallTree } from '../shared/callTree';
import { cellsRead, gridCell, intOf, isInside, keysRead, pairCell, type Cell, type GridCell } from './cells';
import type { GridGraphBindings } from './detect';
import { groupMarks, incrementSteps, liveSteps, markEvents, runOfSpec, type MarkEvent } from './marks';
import type { FrontierRun } from './traversal';

export interface GridFacts {
  live: boolean[];
  /** latest live step at or before each step (-1: none yet) */
  lastLive: number[];
  /** each cell's first mark */
  byCell: Map<string, MarkEvent>;
  byStep: Map<number, MarkEvent[]>;
  /** step of each component's first mark (ascending: components are numbered as they begin) */
  begun: { step: number }[];
  /** the values marked cells had (`keyRepr`): the ground the traversal walks */
  open: Set<string>;
  /** steps the counter went up */
  incs: Set<number>;
  run: FrontierRun | null;
}

export interface Current extends GridCell {
  /** changes whenever the traversal enters a cell anew (replays the pulse) */
  key: string;
}

const factsCache: Cache<GridFacts> = new WeakMap();

const factsKey = (b: GridGraphBindings) => [
  b.objId, b.traversalFn ?? '', b.frontier ? varKey(b.frontier) : '', b.argIdx.join(','), b.marks.kind, b.marks.objId ?? '',
  b.counter ? varKey(b.counter) : '',
].join('|');

export function gridFacts(tl: Timeline, b: GridGraphBindings): GridFacts {
  return cached(factsCache, tl, factsKey(b), () => {
    const live = liveSteps(tl, b);
    const lastLive: number[] = [];
    live.forEach((on, s) => lastLive.push(on ? s : s > 0 ? lastLive[s - 1] : -1));
    const target = b.marks.kind === 'inPlace' ? b.objId : b.marks.objId ?? -1;
    const { marks } = groupMarks(tl, b, markEvents(tl, b, b.marks.kind, target));
    const byCell = new Map<string, MarkEvent>();
    const byStep = new Map<number, MarkEvent[]>();
    const begun: { step: number }[] = [];
    for (const m of marks) {
      byCell.set(cellKey(m), m);
      byStep.set(m.step, [...(byStep.get(m.step) ?? []), m]);
      if (m.comp === begun.length) begun.push({ step: m.step });
    }
    const incs = new Set(b.counter ? incrementSteps(tl, b.counter).filter((s) => live[s]) : []);
    const open = new Set(marks.map((m) => keyRepr(m.was)));
    return { live, lastLive, byCell, byStep, begun, open, incs, run: runOfSpec(tl, b) };
  });
}

/** The (r, c) a traversal call was made with. */
export function argsCell(tl: Timeline, args: readonly V[], [p, q]: readonly [number, number]): Cell | null {
  const r = intOf(tl, args[p]);
  const c = intOf(tl, args[q]);
  return r === null || c === null ? null : { r, c };
}

/** Index of the last element with step ≤ i of a step-sorted list (-1 if none). */
export function lastAtOrBefore(list: readonly { step: number }[], i: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].step <= i) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function currentAt(tl: Timeline, b: GridGraphBindings, f: GridFacts, i: number): Current | null {
  if (!f.live[i]) return null;
  if (b.traversalFn !== undefined) {
    const tree = buildCallTree(tl, [b.traversalFn]);
    const id = activeNode(tl, tree, i);
    const node = id === null ? undefined : tree.nodes.get(id);
    const cell = node ? argsCell(tl, node.args, b.argIdx) : null;
    return node && cell ? { ...gridCell(b, cell), key: `call:${node.callId}` } : null;
  }
  const pops = f.run?.pops ?? [];
  const p = pops[lastAtOrBefore(pops, i)];
  return p && i < p.end ? { ...gridCell(b, p), key: `pop:${p.step}` } : null;
}

/**
 * Cells looked at in step s: read on the grid or the visited structure, or a DFS call stepping off the grid.
 * A marking step's reads are the mark's inputs (`dist[nr][nc] = dist[r][c] + 1`), not probes.
 */
export function probesAt(tl: Timeline, b: GridGraphBindings, f: GridFacts, s: number): GridCell[] {
  if (!f.live[s] || f.byStep.has(s)) return [];
  const cells = cellsRead(tl, b.objId, s);
  if (b.marks.kind === 'array') cells.push(...cellsRead(tl, b.marks.objId!, s));
  if (b.marks.kind === 'set') cells.push(...keysRead(tl, b.marks.objId!, s, b.cols));
  const step = tl.steps[s];
  if (b.traversalFn !== undefined && step.kind === 'call') {
    const call = tl.calls.get(step.callId);
    const cell = call?.fnId === b.traversalFn ? argsCell(tl, call.args, b.argIdx) : null;
    if (cell && !isInside(b, cell.r, cell.c)) cells.push(cell);
  }
  const out: GridCell[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    if (seen.has(cellKey(c))) continue;
    seen.add(cellKey(c));
    out.push(gridCell(b, c));
  }
  return out;
}

const trailCache: Cache<(Cell & { step: number })[]> = new WeakMap();

/** Per live step with something to look at, its most telling cell (current, marked, probed): the focus holds still in between. */
export function focusTrail(tl: Timeline, b: GridGraphBindings): (Cell & { step: number })[] {
  return cached(trailCache, tl, factsKey(b), () => {
    const f = gridFacts(tl, b);
    const out: (Cell & { step: number })[] = [];
    for (let s = 0; s < tl.steps.length; s++) {
      if (!f.live[s]) continue;
      const cur = currentAt(tl, b, f, s);
      const cell = cur?.inside ? cur : f.byStep.get(s)?.[0] ?? probesAt(tl, b, f, s).find((p) => p.inside);
      if (cell) out.push({ step: s, r: cell.r, c: cell.c });
    }
    return out;
  });
}

/** Cells waiting at step i: the DFS calls on the stack below the current one, or the pairs left in the frontier. */
export function waitingAt(tl: Timeline, b: GridGraphBindings, f: GridFacts, i: number, current: Current | null): Cell[] {
  if (!f.live[i]) return [];
  const snap = tl.snapshots[i];
  const out: Cell[] = [];
  const keep = (cell: Cell | null) => {
    if (cell && isInside(b, cell.r, cell.c) && !(current && current.r === cell.r && current.c === cell.c)) out.push(cell);
  };
  if (b.traversalFn !== undefined) {
    for (const frame of snap.frames) {
      if (frame.fnId !== b.traversalFn || current?.key === `call:${frame.callId}`) continue;
      keep(argsCell(tl, tl.calls.get(frame.callId)?.args ?? [], b.argIdx));
    }
    return out;
  }
  const arr = b.frontier ? deref(snap, valueAt(tl, b.frontier, i)) : undefined;
  if (!arr?.elems) return out;
  // a head-index queue keeps what it has read: only the elements past the last one taken out are waiting
  const taken = f.run?.headIndexed ? f.run.pops.filter((p) => p.arrayId === arr.id && p.step <= i).at(-1)?.index ?? -1 : -1;
  arr.elems.forEach((v, k) => {
    if (k > taken) keep(pairCell(tl, snap, v, b.argIdx));
  });
  return out;
}
