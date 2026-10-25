/**
 * How a traversal walks a graph: loops over one node's neighbors — `for (const next of graph[node])`,
 * `graph[node].forEach((next) => …)`, `const next = graph[node][i]` in an index loop, or a counter
 * scanning a whole matrix row (`graph[u][v]` for v = 0 … n−1) — or over an edge list's `[u, v, w]`
 * items; and the variables holding the node being expanded (current), the neighbor and the edge weight,
 * found by matching their values against the entries the loop goes through.
 */
import type { TraceAnalysis } from '../../engine/detect/analysis';
import type { VarRef } from '../../engine/detect/track';
import { frameById, isVisible } from '../../engine/timeline/scope';
import type { FrameSnap, Snapshot, Timeline } from '../../engine/timeline/types';
import { refId } from '../../engine/timeline/values';
import type { IterEvent, Sub } from '../../engine/types/trace';
import type { ObjId, V } from '../../engine/types/values';
import { cached, type Cache } from '../dp1d/table';
import {
  edgeItems, edgeKey, graphRows, listEntries, nodeIdOf, numberOf, type Entry, type GraphEdge, type GraphScan, type NodeId,
} from './structure';

export interface Walk {
  /** the loop over a node's neighbors */
  loopId: number;
  /** the function running the loop (holding `current`; a forEach callback holds `neighbor`) */
  fnId: number;
  current?: VarRef;
  neighbor?: VarRef;
  weight?: VarRef;
  /** times the loop ran over some node's neighbors */
  runs: number;
}

interface Tally {
  loopId: number;
  fnId: number;
  /** loop instances that went over some node's neighbors */
  runs: Set<number>;
  current: Map<number, number>;
  neighbor: Map<number, number>;
  weight: Map<number, number>;
  /** index walks: distinct columns read per loop run and row */
  columns: Map<string, Set<number>>;
}

/** a matrix walk reads (nearly) a whole row in one loop run; a grid walk reads a few neighboring cells */
const ROW_SCAN = 0.75;

const bump = (votes: Map<number, number>, bid: number, n = 1) => votes.set(bid, (votes.get(bid) ?? 0) + n);

function tallyOf(tallies: Map<number, Tally>, loopId: number, fnId: number): Tally {
  let t = tallies.get(loopId);
  if (!t) tallies.set(loopId, (t = { loopId, fnId, runs: new Set(), current: new Map(), neighbor: new Map(), weight: new Map(), columns: new Map() }));
  return t;
}

const iterCache: Cache<Map<number, number[]>> = new WeakMap();

/** for-of loop instance → its iteration steps */
function iterSteps(tl: Timeline): Map<number, number[]> {
  return cached(iterCache, tl, 'iters', () => {
    const out = new Map<number, number[]>();
    tl.steps.forEach((s, i) => {
      if (s.ev?.t !== 'iter') return;
      const list = out.get(s.ev.loop.inst);
      if (list) list.push(i);
      else out.set(s.ev.loop.inst, [i]);
    });
    return out;
  });
}

const span = (tl: Timeline, sub: Sub) => {
  const loc = tl.meta.exprs[sub[0]]?.loc;
  return loc ? loc.end - loc.start : -1;
};

/** The value of the outermost expression evaluated in a loop head (the collection a for-of iterates). */
function iterated(tl: Timeline, subs: Sub[] | undefined): V | undefined {
  let best: Sub | undefined;
  for (const sub of subs ?? []) if (!best || span(tl, sub) > span(tl, best)) best = sub;
  return best?.[1];
}

/** Identifiers in the loop head holding `node` (`node` in `graph[node]`). */
function namesHolding(tl: Timeline, subs: Sub[] | undefined, node: NodeId): Set<string> {
  const out = new Set<string>();
  for (const [exprId, v] of subs ?? []) {
    const e = tl.meta.exprs[exprId];
    if (e?.type === 'Identifier' && nodeIdOf(tl, v) === node) out.add(tl.meta.source.slice(e.loc.start, e.loc.end));
  }
  return out;
}

/** Votes for the frame's in-scope variables holding `value` (`strong` names count triple). */
function voteHolders(tl: Timeline, votes: Map<number, number>, frame: FrameSnap, value: NodeId, strong: (name: string) => boolean,
  skip: readonly number[] = []): void {
  for (const [bid, slot] of frame.vars) {
    const name = tl.meta.bindings[bid]?.name;
    if (!name || skip.includes(bid) || nodeIdOf(tl, slot.v) !== value || !isVisible(tl, frame, bid, slot)) continue;
    bump(votes, bid, strong(name) ? 3 : 1);
  }
}

/** Votes for the bindings taking the entry's node / weight (loop variables, callback parameters, destructured items). */
function voteEntry(tl: Timeline, t: Tally, entry: Entry | undefined, values: [number, V | undefined][], n = 2): void {
  if (!entry) return;
  for (const [bid, v] of values) {
    if (nodeIdOf(tl, v) === entry.to) bump(t.neighbor, bid, n);
    if (entry.weight !== undefined && numberOf(tl, v) === entry.weight) bump(t.weight, bid, n);
  }
}

/** Assignments the loop's own call makes during iteration k (`const [v, w] = e` in the body), loop variables aside. */
function bodyValues(tl: Timeline, steps: number[], k: number, skip: readonly number[]): [number, V | undefined][] {
  const ev = tl.steps[steps[k]].ev as IterEvent;
  const end = steps[k + 1] ?? (tl.loops.get(ev.loop.inst)?.endStep ?? steps[k]) + 1;
  const out: [number, V | undefined][] = [];
  for (let s = steps[k]; s < end && s < tl.diffs.length; s++) {
    for (const c of tl.diffs[s].vars) if (c.callId === ev.callId && !skip.includes(c.bid)) out.push([c.bid, c.value]);
  }
  return out;
}

function rowNode(tl: Timeline, snap: Snapshot, objId: ObjId, g: GraphScan, row: ObjId): NodeId | undefined {
  return graphRows(tl, snap, objId, g.kind)?.find((r) => r.id === row)?.node;
}

/** Votes for the variables taking an edge-list item's endpoints (current, neighbor) and weight. */
function voteItem(tl: Timeline, t: Tally, edge: GraphEdge | undefined, values: [number, V | undefined][], n: number): void {
  if (!edge) return;
  for (const [bid, v] of values) if (nodeIdOf(tl, v) === edge.from) bump(t.current, bid, n);
  voteEntry(tl, t, { to: edge.to, ...(edge.weight !== undefined && { weight: edge.weight }) }, values, n);
}

/** `for (const [u, v, w] of edges)` (or `const [u, v, w] = e` in the body): one item per iteration. */
function edgeLoop(tl: Timeline, objId: ObjId, steps: number[], declares: readonly number[], t: Tally): void {
  const found = edgeItems(tl, tl.snapshots[steps[0]], objId);
  if (!found) return;
  t.runs.add((tl.steps[steps[0]].ev as IterEvent).loop.inst);
  steps.forEach((s, k) => {
    const values = (tl.steps[s].ev as IterEvent).bindings;
    voteItem(tl, t, found.edges[k], declares.map((bid, j) => [bid, values[j]]), 2);
    voteItem(tl, t, found.edges[k], bodyValues(tl, steps, k, declares), 1);
  });
}

/**
 * `for (const next of graph[node])` / `for (const [v, w] of adj[u])`: the first iteration names the list
 * iterated (an edge list: the list itself).
 */
function forOfWalks(tl: Timeline, objId: ObjId, g: GraphScan, tallies: Map<number, Tally>): void {
  for (const steps of iterSteps(tl).values()) {
    const first = tl.steps[steps[0]];
    const ev = first.ev as IterEvent;
    const loop = tl.meta.loops[ev.loop.loopId];
    const list = refId(iterated(tl, ev.sub));
    if (loop?.kind !== 'forOf' || list === null) continue;
    const declares = tl.meta.stmts.find((st) => st.kind === 'forOf' && st.loopId === loop.id)?.declares ?? [];
    if (g.kind === 'edges') {
      if (list === objId) edgeLoop(tl, objId, steps, declares, tallyOf(tallies, loop.id, loop.fnId));
      continue;
    }
    const snap = tl.snapshots[steps[0]];
    const node = g.rows.has(list) ? rowNode(tl, snap, objId, g, list) : undefined;
    const row = snap.heap.get(list);
    const entries = row && listEntries(tl, snap, row);
    const frame = frameById(snap, first.callId);
    if (node === undefined || !entries || !frame) continue;
    const t = tallyOf(tallies, loop.id, loop.fnId);
    t.runs.add(ev.loop.inst);
    const named = namesHolding(tl, ev.sub, node);
    voteHolders(tl, t.current, frame, node, (name) => named.has(name), declares);
    steps.forEach((s, k) => {
      const values = (tl.steps[s].ev as IterEvent).bindings;
      voteEntry(tl, t, entries[k], declares.map((bid, j) => [bid, values[j]]));
      voteEntry(tl, t, entries[k], bodyValues(tl, steps, k, declares), 1);
    });
  }
}

/** `graph[node].forEach((next) => …)`: the list is read as the callback loop starts; its calls take the entries. */
function forEachWalks(tl: Timeline, objId: ObjId, g: GraphScan, tallies: Map<number, Tally>): void {
  for (const li of tl.loops.values()) {
    if (tl.meta.loops[li.loopId]?.kind !== 'callback') continue;
    const read = tl.diffs[li.startStep]?.reads.findLast((r) => r.id === objId && g.rows.has(refId(r.value) ?? -1));
    const snap = tl.snapshots[li.startStep];
    const list = refId(read?.value);
    const frame = snap && frameById(snap, li.callId);
    const node = list === null ? undefined : rowNode(tl, snap, objId, g, list);
    const row = list === null ? undefined : snap.heap.get(list);
    const entries = row && listEntries(tl, snap, row);
    if (!frame || node === undefined || !entries) continue;
    const t = tallyOf(tallies, li.loopId, frame.fnId);
    t.runs.add(li.inst);
    voteHolders(tl, t.current, frame, node, () => false);
    let k = 0;
    for (const call of tl.calls.values()) {
      if (call.parentId !== li.callId || call.enterStep < li.startStep || call.enterStep > (li.endStep ?? Infinity)) continue;
      const callee = frameById(tl.snapshots[call.enterStep], call.callId);
      const params = tl.meta.bindings.filter((b) => b.fnId === call.fnId && b.kind === 'param').map((b) => b.id);
      voteEntry(tl, t, entries[k++], params.map((bid) => [bid, callee?.vars.get(bid)?.v]));
    }
  }
}

interface CellRead {
  step: number;
  row: ObjId;
  column: number;
  value: V;
}

/**
 * Reads of rows by index during loop runs, minus records taken apart: a walk reads one cell of a row per
 * iteration, `e[0]`, `e[1]` (or `edges[j][0]`, `edges[j][1]`) read several of the same row in one.
 */
function cellReads(tl: Timeline, g: GraphScan): CellRead[] {
  const out: (CellRead & { group: string })[] = [];
  const columns = new Map<string, Set<number>>();
  for (let s = 1; s < tl.steps.length; s++) {
    const loop = tl.steps[s].loops.at(-1);
    if (!loop) continue;
    for (const r of tl.diffs[s].reads) {
      if (!g.rows.has(r.id) || r.path.length !== 1 || typeof r.path[0] !== 'number') continue;
      const group = `${tl.steps[s].callId}:${loop.inst}:${loop.iteration}:${r.id}`;
      columns.set(group, (columns.get(group) ?? new Set<number>()).add(r.path[0]));
      out.push({ step: s, row: r.id, column: r.path[0], value: r.value, group });
    }
  }
  return out.filter((c) => columns.get(c.group)!.size === 1);
}

/**
 * Reads of a row's elements by index. List: the element is the neighbor, taken into a variable in the
 * same step (`const next = graph[node][i]`). Matrix: the column is, and it is the counter of a loop
 * reading (nearly) the whole row (`for (let v = 0; v < n; v++) if (adj[u][v]) …`).
 */
function indexWalks(tl: Timeline, objId: ObjId, g: GraphScan, tallies: Map<number, Tally>): void {
  const matrix = g.kind === 'matrix';
  for (const { step: s, row, column, value } of cellReads(tl, g)) {
    const snap = tl.snapshots[s];
    const frame = frameById(snap, tl.steps[s].callId);
    const loop = frame?.loops.last();
    const node = rowNode(tl, snap, objId, g, row);
    const to = matrix ? String(column) : nodeIdOf(tl, value) ?? nodeIdOf(tl, snap.heap.get(refId(value) ?? -1)?.elems?.get(0));
    if (!frame || !loop || node === undefined || to === null) continue;
    const counters = tl.meta.loops[loop.loopId]?.counters ?? [];
    const t = tallyOf(tallies, loop.loopId, frame.fnId);
    voteHolders(tl, t.current, frame, node, () => false);
    if (matrix) {
      // the column is the loop's counter
      const others = frame.vars.keySeq().filter((bid) => !counters.includes(tl.meta.bindings[bid]?.name ?? '')).toArray();
      voteHolders(tl, t.neighbor, frame, to, () => true, others);
    } else {
      for (const c of tl.diffs[s].vars) if (c.callId === frame.callId && nodeIdOf(tl, c.value) === to) bump(t.neighbor, c.bid);
    }
    const key = `${loop.inst}:${row}`;
    t.columns.set(key, (t.columns.get(key) ?? new Set<number>()).add(column));
    t.runs.add(loop.inst);
  }
}

/** `const [u, v, w] = edges[j]` in an index loop: the item read and taken apart in one step. */
function edgeIndexWalks(tl: Timeline, objId: ObjId, g: GraphScan, tallies: Map<number, Tally>): void {
  for (let s = 1; s < tl.steps.length; s++) {
    const read = tl.diffs[s].reads.find((r) => r.id === objId && typeof r.path[0] === 'number' && g.rows.has(refId(r.value) ?? -1));
    if (!read) continue;
    const snap = tl.snapshots[s];
    const frame = frameById(snap, tl.steps[s].callId);
    const loop = frame?.loops.last();
    const edge = edgeItems(tl, snap, objId)?.edges[read.path[0] as number];
    if (!frame || !loop || !edge) continue;
    const t = tallyOf(tallies, loop.loopId, frame.fnId);
    t.runs.add(loop.inst);
    voteItem(tl, t, edge, tl.diffs[s].vars.filter((c) => c.callId === frame.callId).map((c) => [c.bid, c.value]), 1);
  }
}

/** The variable with the most votes, as a ref over every binding of that name voted for. */
function winner(tl: Timeline, votes: Map<number, number>, skip?: VarRef): VarRef | undefined {
  let best: number | undefined;
  for (const [bid, n] of votes) if (!skip?.bids.includes(bid) && (best === undefined || n > (votes.get(best) ?? 0))) best = bid;
  if (best === undefined) return undefined;
  const { name, fnId } = tl.meta.bindings[best];
  const bids = [...votes.keys()].filter((bid) => tl.meta.bindings[bid]?.name === name && tl.meta.bindings[bid]?.fnId === fnId && !skip?.bids.includes(bid));
  return { name, fnId, bids: bids.sort((x, y) => x - y) };
}

function toWalk(tl: Timeline, g: GraphScan, t: Tally): Walk | null {
  const current = winner(tl, t.current);
  const neighbor = winner(tl, t.neighbor, current);
  if (!current || (g.kind === 'edges' && !neighbor)) return null;
  if (g.kind === 'matrix' || t.columns.size) {
    // index walks need their neighbor; a matrix walk scans whole rows
    const widest = Math.max(0, ...[...t.columns.values()].map((c) => c.size));
    if (!neighbor || (g.kind === 'matrix' && widest < Math.min(g.nodes.length, Math.max(2, Math.ceil(ROW_SCAN * g.nodes.length))))) return null;
  }
  const weight = neighbor && winner(tl, t.weight, neighbor);
  return { loopId: t.loopId, fnId: t.fnId, current, ...(neighbor && { neighbor }), ...(weight && { weight }), runs: t.runs.size };
}

const walkCache: Cache<Walk[]> = new WeakMap();

/** Every loop walking this graph's neighbors, the busiest first. */
export function findWalks(tl: Timeline, objId: ObjId, g: GraphScan): Walk[] {
  return cached(walkCache, tl, `${g.kind}:${objId}`, () => {
    const tallies = new Map<number, Tally>();
    if (g.kind !== 'matrix') forOfWalks(tl, objId, g, tallies);
    if (g.kind === 'list' || g.kind === 'object') forEachWalks(tl, objId, g, tallies);
    if (!tallies.size && (g.kind === 'list' || g.kind === 'matrix')) indexWalks(tl, objId, g, tallies);
    if (!tallies.size && g.kind === 'edges') edgeIndexWalks(tl, objId, g, tallies);
    const out = [...tallies.values()].flatMap((t) => toWalk(tl, g, t) ?? []);
    return out.sort((x, y) => y.runs - x.runs);
  });
}

/** A recursive function called with a neighbor of the node its calling invocation had (in the same argument). */
export function recursesOverEdges(tl: Timeline, a: TraceAnalysis, fnId: number, g: GraphScan): boolean {
  if (!a.recursiveFns.has(fnId)) return false;
  const edges = new Set(g.edges.map((e) => edgeKey(e.from, e.to)));
  for (const call of tl.calls.values()) {
    if (call.fnId !== fnId) continue;
    // the nearest enclosing call of the same function (through callbacks such as forEach)
    let p = tl.calls.get(call.parentId);
    for (let hops = 0; p && p.fnId !== fnId && hops < 8; hops++) p = p.parentId === p.callId ? undefined : tl.calls.get(p.parentId);
    if (!p || p.fnId !== fnId || p.callId === call.callId) continue;
    for (let k = 0; k < call.args.length; k++) {
      const from = nodeIdOf(tl, p.args[k]);
      const to = nodeIdOf(tl, call.args[k]);
      if (from !== null && to !== null && edges.has(edgeKey(from, to))) return true;
    }
  }
  return false;
}
