/**
 * How a traversal moves over a grid. DFS: a recursive function whose calls take (r, c) and whose child calls
 * step to a neighbor cell. BFS: a frontier — the arrays of [r, c] pairs one variable holds, drained by shift /
 * pop (or read at a rising head index) and fed the neighbors of the cell taken out last. Each move names the
 * steps in which reading the cell moved to backs it (the detector checks them against candidate grids). A BFS
 * run (session) is the loop that took the cell out; it ends with that loop. Pure.
 */
import type { TraceAnalysis, VarInfo } from '../../engine/detect/analysis';
import { trackVar, type VarRef } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import { cached, type Cache } from '../dp1d/table';
import { buildCallTree, type CallTree, type TreeNode } from '../shared/callTree';
import { adjacent, intOf, pairCell, type Cell } from './cells';

export const MIN_MOVES = 4;

export interface Move {
  from: Cell;
  to: Cell;
  /** step ranges (inclusive) in which reading `to` backs the move */
  windows: [number, number][];
}

export interface DfsFit {
  kind: 'dfs';
  fnId: number;
  /** argument positions of the coordinates (either order: the grid's reads decide which one is the row) */
  argIdx: [number, number];
  moves: Move[];
}

export interface FrontierEvent extends Cell {
  step: number;
  /** the pair array */
  pairId: ObjId | null;
}

export interface Pop extends FrontierEvent {
  arrayId: ObjId;
  /** head-index queues: the element read */
  index?: number;
  /** the run (loop) taking the cell out: its first step and the step it ended */
  start: number;
  end: number;
}

export interface FrontierRun {
  pops: Pop[];
  /** pairs added, including those a frontier array starts with */
  pushes: FrontierEvent[];
  /** drained by reading at a rising index instead of removing */
  headIndexed: boolean;
}

export interface BfsFit extends FrontierRun {
  kind: 'bfs';
  frontier: VarRef;
  moves: Move[];
}

export type Traversal = DfsFit | BfsFit;

const lastStep = (tl: Timeline) => tl.steps.length - 1;

/** From the previous sibling's end (or the parent's start) up to the call's own first recursive call. */
function dfsWindow(tl: Timeline, tree: CallTree, node: TreeNode): [number, number] {
  const parent = tree.nodes.get(node.parent!)!;
  const k = parent.children.indexOf(node.callId);
  const from = k > 0 ? tree.nodes.get(parent.children[k - 1])!.exitStep ?? parent.enterStep : parent.enterStep;
  const firstChild = node.children.length ? tree.nodes.get(node.children[0])!.enterStep : undefined;
  return [from, firstChild ?? node.exitStep ?? lastStep(tl)];
}

const cellAt = (ints: (number | null)[], p: number, q: number): Cell | null => {
  const r = ints[p] ?? null;
  const c = ints[q] ?? null;
  return r === null || c === null ? null : { r, c };
};

/** The pair of integer arguments whose values step to a neighbor between parent and child calls most often. */
function dfsFit(tl: Timeline, fnId: number): DfsFit | null {
  const tree = buildCallTree(tl, [fnId]);
  const ints = new Map<number, (number | null)[]>();
  let n = 0;
  for (const node of tree.nodes.values()) {
    ints.set(node.callId, node.args.map((v) => intOf(tl, v)));
    n = Math.max(n, node.args.length);
  }
  let best: DfsFit | null = null;
  for (let p = 0; p < n; p++) {
    for (let q = p + 1; q < n; q++) {
      const moves: Move[] = [];
      for (const node of tree.nodes.values()) {
        if (node.parent === null) continue;
        const from = cellAt(ints.get(node.parent)!, p, q);
        const to = cellAt(ints.get(node.callId)!, p, q);
        if (from && to && adjacent(from, to)) moves.push({ from, to, windows: [dfsWindow(tl, tree, node)] });
      }
      if (moves.length >= MIN_MOVES && (!best || moves.length > best.moves.length)) best = { kind: 'dfs', fnId, argIdx: [p, q], moves };
    }
  }
  return best;
}

/** Distinct arrays a variable holds over the trace. */
export function heldArrays(tl: Timeline, ref: VarRef): ObjId[] {
  const ids = new Set<ObjId>();
  for (const v of trackVar(tl, ref)) {
    const id = refId(v);
    if (id !== null && tl.snapshots[tl.snapshots.length - 1].heap.get(id)?.kind === 'array') ids.add(id);
  }
  return [...ids];
}

/**
 * The BFS run a pop at step s belongs to: the innermost loop around it that ends with the frontier array empty
 * or holds every pop from that array (a level-by-level BFS drains each level in an inner loop: the run is the
 * loop around it), else the innermost loop, else the frame. Its first step and the step it ended.
 */
function runOf(tl: Timeline, s: number, arrayId: ObjId, [first, last]: [number, number]): { start: number; end: number } {
  const loops = tl.steps[s].loops.map((l) => tl.loops.get(l.inst)).filter((l) => l !== undefined).reverse();
  const endOf = (l: (typeof loops)[number]) => l.endStep ?? lastStep(tl) + 1;
  const drained = (l: (typeof loops)[number]) => !tl.snapshots[Math.min(endOf(l), lastStep(tl))].heap.get(arrayId)?.elems?.size;
  const loop = loops.find((l) => drained(l) || (l.startStep <= first && endOf(l) >= last)) ?? loops[0];
  if (loop) return { start: loop.startStep, end: endOf(loop) };
  const call = tl.calls.get(tl.steps[s].callId);
  return { start: call?.enterStep ?? 0, end: call?.exitStep ?? lastStep(tl) + 1 };
}

const runCache: Cache<FrontierRun> = new WeakMap();

/** Pairs added to and taken out of the frontier arrays `ids`, in step order (`order`: positions of r and c in a pair). */
export function frontierRun(tl: Timeline, ids: readonly ObjId[], order: readonly [number, number] = [0, 1]): FrontierRun {
  return cached(runCache, tl, `${ids.join(',')}/${order.join(',')}`, () => {
    const set = new Set(ids);
    const pushes: FrontierEvent[] = [];
    const taken: (FrontierEvent & { arrayId: ObjId; index?: number })[] = [];
    const removing = new Set<ObjId>();
    const event = (s: number, v: V | undefined): FrontierEvent | null => {
      const cell = pairCell(tl, tl.snapshots[s], v, order);
      return cell && { ...cell, step: s, pairId: refId(v) };
    };
    const push = (s: number, v: V | undefined) => {
      const e = event(s, v);
      if (e) pushes.push(e);
    };
    const pop = (s: number, arrayId: ObjId, v: V | undefined, index?: number) => {
      const e = event(s, v);
      if (e) taken.push({ ...e, arrayId, ...(index !== undefined && { index }) });
    };
    for (let s = 0; s < tl.diffs.length; s++) {
      for (const h of tl.diffs[s].heap) {
        if (!set.has(h.id)) continue;
        if (h.op === 'alloc') {
          for (const v of tl.snapshots[s].heap.get(h.id)?.elems ?? []) push(s, v);
        } else if (h.op === 'push' || h.op === 'unshift') {
          for (const v of h.args ?? []) push(s, v);
        } else if (h.op === 'shift' || h.op === 'pop' || (h.op === 'splice' && h.removed?.length === 1)) {
          removing.add(h.id);
          pop(s, h.id, h.op === 'splice' ? h.removed?.[0] : h.old);
        }
      }
    }
    // `queue[head++]`: arrays never drained are read at a rising index instead
    const headIndexed = removing.size === 0;
    if (headIndexed) {
      const read = new Set<string>();
      for (let s = 0; s < tl.diffs.length; s++) {
        for (const e of tl.diffs[s].reads) {
          const index = e.path[0];
          if (!set.has(e.id) || typeof index !== 'number' || read.has(`${e.id}:${index}`)) continue;
          read.add(`${e.id}:${index}`);
          pop(s, e.id, e.value, index);
        }
      }
    }
    // first and last pop of each array bound the loops its runs can be
    const spans = new Map<ObjId, [number, number]>();
    for (const p of taken) spans.set(p.arrayId, [spans.get(p.arrayId)?.[0] ?? p.step, p.step]);
    const pops = taken.map((p): Pop => ({ ...p, ...runOf(tl, p.step, p.arrayId, spans.get(p.arrayId)!) }));
    return { pops, pushes, headIndexed };
  });
}

/** BFS moves: each pair added after a pop that neighbors the cell popped; read before adding, or once taken out. */
function bfsMoves(tl: Timeline, run: FrontierRun): Move[] {
  const popIndex = new Map<ObjId, number>();
  run.pops.forEach((p, k) => {
    if (p.pairId !== null && !popIndex.has(p.pairId)) popIndex.set(p.pairId, k);
  });
  const moves: Move[] = [];
  let k = 0;
  let cur: Pop | null = null;
  for (const push of run.pushes) {
    while (k < run.pops.length && run.pops[k].step <= push.step) cur = run.pops[k++];
    if (!cur || !adjacent(cur, push)) continue;
    const windows: [number, number][] = [[cur.step, push.step]];
    const own = push.pairId === null ? undefined : popIndex.get(push.pairId);
    if (own !== undefined) windows.push([run.pops[own].step, (run.pops[own + 1]?.step ?? lastStep(tl) + 1) - 1]);
    moves.push({ from: { r: cur.r, c: cur.c }, to: { r: push.r, c: push.c }, windows });
  }
  return moves;
}

/** Variables holding arrays that get [r, c] pairs added (a frontier is never claimed: the queue / stack views keep it). */
function frontierVars(a: TraceAnalysis): VarInfo[] {
  const out = new Map<string, VarInfo>();
  for (const o of a.objects.values()) {
    if (o.kind !== 'array' || !o.nested || (o.ops.push ?? 0) + (o.ops.unshift ?? 0) === 0) continue;
    for (const key of o.varKeys) {
      const v = a.vars.get(key);
      if (v && !v.kinds.has('fn')) out.set(key, v);
    }
  }
  return [...out.values()].sort((x, y) => x.firstStep - y.firstStep);
}

const fitCache: Cache<Traversal[]> = new WeakMap();

/** Every traversal in the trace with at least MIN_MOVES neighbor moves (cached per timeline). */
export function traversals(tl: Timeline, a: TraceAnalysis): Traversal[] {
  return cached(fitCache, tl, 'all', () => {
    const out: Traversal[] = [];
    for (const fnId of a.recursiveFns) {
      const fit = dfsFit(tl, fnId);
      if (fit) out.push(fit);
    }
    const seen = new Set<string>();
    for (const v of frontierVars(a)) {
      const ids = heldArrays(tl, v.ref);
      if (!ids.length || seen.has(ids.join(','))) continue;
      seen.add(ids.join(','));
      const run = frontierRun(tl, ids);
      const moves = bfsMoves(tl, run);
      if (run.pops.length && moves.length >= MIN_MOVES) out.push({ kind: 'bfs', frontier: v.ref, ...run, moves });
    }
    return out;
  });
}
