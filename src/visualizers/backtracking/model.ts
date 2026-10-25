/**
 * Pure per-step model of the backtracking view (testable without WebGL): the choice on each tree edge,
 * solutions and dead ends, and the side panel — the path, board or flags the choices build and the
 * solutions recorded so far.
 */
import { valueAt, type VarRef } from '../../engine/detect/track';
import { keyRepr, orderedEntries, orderedProps } from '../../engine/timeline/heap';
import type { HeapChange, HeapObj, Snapshot, Timeline } from '../../engine/timeline/types';
import { deref, previewValue, primitive, refId } from '../../engine/timeline/values';
import { sameV, UNDEF, type V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import { callText, constantArgs, type CallTree, type NodePhase, type TreeNode } from '../shared/callTree';
import { defaultLook, LABEL_SIZE, type NodeLook } from '../shared/treeState';
import { choiceWindows, ownerCall, pendingPush, slotOf, treeCallOf, type StepChange } from './choices';
import type { BacktrackBindings } from './detect';

/** path blocks: the choices currently made (a muted amber, like the lit path in the tree) */
export const PATH_COLOR = '#8a6417';
/** edge label font size used by CallTreeView */
const EDGE_LABEL_SIZE = 0.24;

export const textWidth = (s: string, size: number) => [...s].length * size * 0.6;

/** Compact text: strings without quotes, everything else as a depth-0 preview, cut to `max` characters. */
export function short(tl: Timeline, snap: Snapshot, v: V | undefined, max = 6): string {
  const p = primitive(tl, v);
  const text = p.ok && typeof p.value === 'string' ? p.value : previewValue(tl, snap, v, { depth: 0, maxString: max });
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Row object ids of a 2D board at step i (-1 for elements that are not arrays). */
export function boardRows(tl: Timeline, ref: VarRef, i: number): number[] {
  const outer = deref(tl.snapshots[i], valueAt(tl, ref, i));
  return (outer?.elems?.toArray() ?? []).map((e) => refId(e) ?? -1);
}

const lastOf = (list: StepChange[], ok: (c: StepChange) => boolean) => list.findLast(ok);

// ── tree annotations ──

export interface TreeInfo {
  /** call → the choice its parent made right before calling it ("+2", "(1,3)", "2 ✓") */
  choice: Map<number, string>;
  /** call → its first solution: number in order of discovery and the step that recorded it */
  solution: Map<number, { index: number; step: number }>;
  /** steps that recorded a solution, in order */
  solutionSteps: number[];
  /** calls with no solution anywhere in their subtree (dead ends once they return) */
  barren: Set<number>;
  /** board cell (`rowId:col`) → its value before the first choice made on it */
  resting: Map<string, V>;
  /** the resting value most cells share (e.g. '.', as a key repr): left unlabeled on the board */
  blank: string | null;
}

function flagChoice(tl: Timeline, snap: Snapshot, h: HeapChange): string | null {
  const key = h.op === 'set' || h.op === 'delete' ? String(h.path[0]) : short(tl, snap, h.key, 5);
  switch (h.op) {
    case 'set': return h.value === true ? `${key} ✓` : `${key}=${short(tl, snap, h.value, 4)}`;
    case 'setAdd': return `+${key}`;
    case 'mapSet': return `${key}=${short(tl, snap, h.value, 4)}`;
    case 'delete': case 'setDelete': case 'mapDelete': return `−${key}`;
    default: return null;
  }
}

function choiceLabels(tl: Timeline, tree: CallTree, b: BacktrackBindings): Map<number, string> {
  const out = new Map<number, string>();
  for (const w of choiceWindows(tl, tree)) {
    const at = tree.nodes.get(w.child)!.enterStep;
    const snap = tl.snapshots[at];
    let text: string | null = null;
    if (b.mode === 'path' && b.path) {
      const id = refId(valueAt(tl, b.path, at));
      const p = id === null ? null : pendingPush(w, id);
      if (p) text = `+${(p.h.args ?? []).map((v) => short(tl, snap, v, 5)).join(',')}`;
    } else if (b.mode === 'board' && b.board) {
      const rows = boardRows(tl, b.board, at);
      const c = lastOf(w.before, (x) => x.h.op === 'set' && typeof x.h.path[0] === 'number' && rows.includes(x.h.id));
      if (c) text = `(${rows.indexOf(c.h.id)},${c.h.path[0]})`;
    } else if (b.mode === 'flags' && b.flags) {
      const id = refId(valueAt(tl, b.flags, at));
      const c = lastOf(w.before, (x) => x.h.id === id && slotOf(x.h) !== null);
      if (c) text = flagChoice(tl, snap, c.h);
    }
    if (text) out.set(w.child, text);
  }
  return out;
}

/** Pushes onto the results collection, credited to the tree call they happened in (or its helpers). */
function solutionsOf(tl: Timeline, tree: CallTree, ref: VarRef | undefined): Pick<TreeInfo, 'solution' | 'solutionSteps'> {
  const solution: TreeInfo['solution'] = new Map();
  const solutionSteps: number[] = [];
  if (!ref) return { solution, solutionSteps };
  for (let s = 0; s < tl.diffs.length; s++) {
    const heap = tl.diffs[s].heap;
    if (!heap.length) continue;
    const id = refId(valueAt(tl, ref, s));
    if (id === null || !heap.some((h) => h.id === id && h.op === 'push')) continue;
    const owner = treeCallOf(tl, tree, ownerCall(tl, s));
    if (owner === null) continue;
    solutionSteps.push(s);
    if (!solution.has(owner)) solution.set(owner, { index: solutionSteps.length, step: s });
  }
  return { solution, solutionSteps };
}

/** Each board cell's value before the recursion first changed it, and the value most cells rest at. */
function restingCells(tl: Timeline, tree: CallTree, ref: VarRef): Pick<TreeInfo, 'resting' | 'blank'> {
  const resting = new Map<string, V>();
  for (let s = 0; s < tl.diffs.length; s++) {
    const heap = tl.diffs[s].heap;
    if (!heap.some((h) => h.op === 'set') || !tree.nodes.has(ownerCall(tl, s))) continue;
    const rows = boardRows(tl, ref, s);
    for (const h of heap) {
      if (h.op !== 'set' || typeof h.path[0] !== 'number' || !rows.includes(h.id)) continue;
      const k = `${h.id}:${h.path[0]}`;
      if (!resting.has(k)) resting.set(k, h.old ?? UNDEF);
    }
  }
  const counts = new Map<string, number>();
  for (const v of resting.values()) counts.set(keyRepr(v), (counts.get(keyRepr(v)) ?? 0) + 1);
  const top = [...counts].sort((x, y) => y[1] - x[1])[0];
  return { resting, blank: top && top[1] >= resting.size * 0.6 ? top[0] : null };
}

const infoCache = new WeakMap<CallTree, Map<string, { steps: number; info: TreeInfo }>>();

export function treeInfo(tl: Timeline, tree: CallTree, b: BacktrackBindings): TreeInfo {
  const key = [b.mode, b.path, b.board, b.flags, b.results].map((r) => (typeof r === 'string' ? r : r ? `${r.fnId}:${r.name}` : '')).join('|');
  let byKey = infoCache.get(tree);
  if (!byKey) infoCache.set(tree, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.steps === tl.steps.length) return hit.info;
  const { solution, solutionSteps } = solutionsOf(tl, tree, b.results);
  const fruitful = new Set<number>();
  // entry order lists parents first, so reversed every child is settled before its parent
  for (const n of [...tree.nodes.values()].reverse()) {
    if (solution.has(n.callId) || n.children.some((c) => fruitful.has(c))) fruitful.add(n.callId);
  }
  const info: TreeInfo = {
    choice: choiceLabels(tl, tree, b),
    solution,
    solutionSteps,
    barren: new Set([...tree.nodes.keys()].filter((id) => !fruitful.has(id))),
    ...(b.board ? restingCells(tl, tree, b.board) : { resting: new Map(), blank: null }),
  };
  byKey.set(key, { steps: tl.steps.length, info });
  return info;
}

export type NodeMark = { kind: 'solution'; index: number } | { kind: 'pruned' };

/** Solution once its result is recorded; pruned once a call without any solution below it has returned. */
export function nodeMark(info: TreeInfo, node: TreeNode, i: number, hasResults: boolean): NodeMark | null {
  const sol = info.solution.get(node.callId);
  if (sol && sol.step <= i) return { kind: 'solution', index: sol.index };
  if (hasResults && node.exitStep !== undefined && node.exitStep <= i && info.barren.has(node.callId)) return { kind: 'pruned' };
  return null;
}

/**
 * Default phase colors; solutions glow green with "✓ #2" (a solution still on the stack keeps its blue so
 * the stack stays readable), dead ends fade red with "✗"; otherwise the return value, if any.
 */
export function nodeLook(phase: NodePhase, mark: NodeMark | null, label: string, returned?: string): NodeLook {
  const look: NodeLook = { ...defaultLook(phase), label };
  if (phase === 'future' || phase === 'threw') return look;
  if (mark?.kind === 'solution') {
    const badge = { badge: `✓ #${mark.index}`, badgeColor: COLORS.done };
    return phase === 'waiting' ? { ...look, ...badge } : { ...look, ...badge, color: COLORS.done, glow: phase === 'active' ? 1.6 : 1.1 };
  }
  if (mark?.kind === 'pruned') {
    return { ...look, color: COLORS.error, glow: 0.3, opacity: 0.45, badge: '✗', badgeColor: COLORS.error, labelColor: COLORS.inkFaint };
  }
  return returned ? { ...look, badge: `= ${returned}` } : look;
}

/** The root shows the whole call (`place(0)`); below it only what changes between calls: `(1)`, or nothing. */
export function nodeLabels(tl: Timeline, tree: CallTree): Map<number, string> {
  const constant = constantArgs(tree);
  const out = new Map<number, string>();
  for (const n of tree.nodes.values()) {
    const snap = tl.snapshots[n.enterStep];
    const same = constant.get(n.fnId);
    if (n.parent === null) {
      out.set(n.callId, callText(tl, snap, n, same));
      continue;
    }
    const args = n.args.filter((_, k) => !same?.has(k)).map((v) => previewValue(tl, snap, v, { depth: 0, maxString: 6 }));
    out.set(n.callId, args.length ? `(${args.join(', ')})` : '');
  }
  return out;
}

/** Layout width of a node: room for its label and, between siblings, for the choice on its edge. */
export const nodeWidth = (label: string, edge: string) =>
  Math.max(1, textWidth(label, LABEL_SIZE) + 0.3, 2 * textWidth(edge, EDGE_LABEL_SIZE) + 0.1);

// ── side panel ──

export interface SlotModel {
  key: string;
  label: string;
  color: string;
  /** changed this step */
  pulse: boolean;
  /** just pushed: drops into place */
  entered: boolean;
  /** index under the block */
  sub?: string;
}

export interface RowModel {
  name: string;
  slots: SlotModel[];
  /** slots the row makes room for (its largest size in the trace) */
  capacity: number;
  /** element just removed (popped / push undone), drawn lifting out */
  leaving: { index: number; label: string } | null;
}

export interface BoardModel {
  name: string;
  exists: boolean;
  rows: number;
  cols: number;
  /** row-major cell texts ('' = unlabeled) */
  text: string[];
  /** row-major: the cell holds a choice (differs from its resting value) */
  placed: boolean[];
  marks: { r: number; c: number; kind: 'changed' | 'checking' }[];
}

export interface ResultsModel {
  name: string;
  count: number;
  latest: string | null;
  /** a solution was recorded at this step */
  found: boolean;
  /** longest `latest` text in the trace (stable panel width) */
  widest: number;
}

export interface PanelModel {
  path: RowModel | null;
  board: BoardModel | null;
  flags: RowModel | null;
  results: ResultsModel | null;
}

const LATEST_MAX = 24;

type Cache<T> = WeakMap<Timeline, Map<string, { steps: number; value: T }>>;

function cached<T>(cache: Cache<T>, tl: Timeline, key: string, make: () => T): T {
  let byKey = cache.get(tl);
  if (!byKey) cache.set(tl, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.steps === tl.steps.length) return hit.value;
  const value = make();
  byKey.set(key, { steps: tl.steps.length, value });
  return value;
}

const objAt = (tl: Timeline, ref: VarRef, i: number) => deref(tl.snapshots[i], valueAt(tl, ref, i));
const sizeOf = (o: HeapObj | undefined) => (o ? o.elems?.size ?? o.entries?.size ?? o.props?.size ?? 0 : 0);
const touched = (tl: Timeline, i: number) => i === 0 || tl.diffs[i].heap.length > 0 || tl.diffs[i].vars.length > 0;

const sizeCache: Cache<number> = new WeakMap();
/** Largest size (elements / entries / props) the variable's object reaches. */
function maxSize(tl: Timeline, ref: VarRef): number {
  return cached(sizeCache, tl, `${ref.fnId}:${ref.name}`, () => {
    let max = 0;
    for (let i = 0; i < tl.steps.length; i++) if (touched(tl, i)) max = Math.max(max, sizeOf(objAt(tl, ref, i)));
    return max;
  });
}

const dimsCache: Cache<{ rows: number; cols: number }> = new WeakMap();
function boardDims(tl: Timeline, ref: VarRef): { rows: number; cols: number } {
  return cached(dimsCache, tl, `${ref.fnId}:${ref.name}`, () => {
    let rows = 0;
    let cols = 0;
    for (let i = 0; i < tl.steps.length; i++) {
      if (!touched(tl, i)) continue;
      const ids = boardRows(tl, ref, i);
      rows = Math.max(rows, ids.length);
      for (const id of ids) cols = Math.max(cols, tl.snapshots[i].heap.get(id)?.elems?.size ?? 0);
    }
    return { rows, cols };
  });
}

function pathRow(tl: Timeline, i: number, ref: VarRef, hl: Highlight | null): RowModel {
  const snap = tl.snapshots[i];
  const obj = objAt(tl, ref, i);
  const elems = obj?.elems?.toArray() ?? [];
  const entered = new Set<number>();
  let leaving: RowModel['leaving'] = null;
  const reversed = hl?.reversed ?? false;
  for (const h of hl?.diff.heap ?? []) {
    if (h.id !== obj?.id || (h.op !== 'push' && h.op !== 'pop')) continue;
    const at = typeof h.path[0] === 'number' ? h.path[0] : elems.length;
    // forward push / undone pop: the element is (back) in place; forward pop / undone push: it just left
    if ((h.op === 'push') !== reversed) for (let k = 0; k < (h.op === 'push' ? h.args?.length ?? 1 : 1); k++) entered.add(at + k);
    else leaving = { index: at, label: short(tl, snap, h.op === 'pop' ? h.old : h.args?.[0], 4) };
  }
  const slots = elems.map((e, k): SlotModel => ({
    key: `p${k}`, label: short(tl, snap, e, 4), color: entered.has(k) ? COLORS.changed : PATH_COLOR,
    pulse: entered.has(k), entered: entered.has(k), sub: String(k),
  }));
  return { name: ref.name, slots, capacity: Math.max(1, maxSize(tl, ref)), leaving };
}

const truthy = (tl: Timeline, v: V | undefined) => refId(v) !== null || Boolean(primitive(tl, v).value);
const entryKeyOf = (h: HeapChange) => (h.op === 'set' || h.op === 'delete' ? `:${String(h.path[0])}` : `#${keyRepr(h.key)}`);

/** Display items of a flags container: array slots, Set members, Map / object entries. */
function flagItems(tl: Timeline, snap: Snapshot, obj: HeapObj | undefined): { key: string; label: string; on: boolean; sub?: string }[] {
  if (!obj) return [];
  if (obj.elems) {
    return obj.elems.toArray().map((e, k) => ({
      key: `:${k}`, label: e === true ? '✓' : truthy(tl, e) || e === 0 ? short(tl, snap, e, 3) : '', on: truthy(tl, e), sub: String(k),
    }));
  }
  if (obj.entries) {
    return orderedEntries(obj).map((e) => ({
      key: `#${keyRepr(e.k)}`, label: obj.kind === 'set' ? short(tl, snap, e.v, 4) : `${short(tl, snap, e.k, 3)}=${short(tl, snap, e.v, 2)}`, on: true,
    }));
  }
  return orderedProps(obj).map(([k, slot]) => ({
    key: `:${k}`, label: slot.v === true ? k.slice(0, 4) : `${k.slice(0, 2)}=${short(tl, snap, slot.v, 2)}`, on: truthy(tl, slot.v),
  }));
}

function flagsRow(tl: Timeline, i: number, ref: VarRef, hl: Highlight | null): RowModel {
  const snap = tl.snapshots[i];
  const obj = objAt(tl, ref, i);
  const changed = new Set<string>();
  const checking = new Set<string>();
  for (const h of hl?.diff.heap ?? []) if (h.id === obj?.id && slotOf(h) !== null) changed.add(entryKeyOf(h));
  for (const r of hl?.diff.reads ?? []) {
    if (r.id !== obj?.id) continue;
    if (r.key !== undefined) checking.add(`#${keyRepr(r.key)}`);
    else if (r.path.length === 1) checking.add(`:${String(r.path[0])}`);
  }
  const slots = flagItems(tl, snap, obj).map((it): SlotModel => {
    const pulse = changed.has(it.key);
    const color = pulse ? COLORS.changed : checking.has(it.key) ? COLORS.frontier : it.on ? COLORS.visited : COLORS.idle;
    return { key: it.key, label: it.label, color, pulse, entered: false, sub: it.sub };
  });
  return { name: ref.name, slots, capacity: Math.max(1, maxSize(tl, ref)), leaving: null };
}

function cellText(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  if (v === true) return '✓';
  const p = primitive(tl, v);
  if (v === undefined || v === false || v === null || (p.ok && p.value === undefined)) return '';
  return short(tl, snap, v, 3);
}

function boardModel(tl: Timeline, i: number, ref: VarRef, info: TreeInfo, hl: Highlight | null): BoardModel {
  const snap = tl.snapshots[i];
  const { rows, cols } = boardDims(tl, ref);
  const ids = boardRows(tl, ref, i);
  const text: string[] = [];
  const placed: boolean[] = [];
  for (let r = 0; r < rows; r++) {
    const elems = ids[r] === undefined ? undefined : snap.heap.get(ids[r])?.elems;
    for (let c = 0; c < cols; c++) {
      const v = elems?.get(c);
      const rest = info.resting.get(`${ids[r]}:${c}`);
      placed.push(rest !== undefined && v !== undefined && !sameV(v, rest));
      text.push(v !== undefined && info.blank !== null && keyRepr(v) === info.blank ? '' : cellText(tl, snap, v));
    }
  }
  const marks: BoardModel['marks'] = [];
  const seen = new Set<string>();
  const mark = (id: number, c: string | number | undefined, kind: 'changed' | 'checking') => {
    const r = ids.indexOf(id);
    if (r < 0 || typeof c !== 'number' || seen.has(`${r}:${c}`)) return;
    seen.add(`${r}:${c}`);
    marks.push({ r, c, kind });
  };
  for (const h of hl?.diff.heap ?? []) if (h.op === 'set') mark(h.id, h.path[0], 'changed');
  for (const x of hl?.diff.reads ?? []) mark(x.id, x.path[0], 'checking');
  return { name: ref.name, exists: ids.length > 0, rows, cols, text, placed, marks };
}

const widestCache: Cache<number> = new WeakMap();

function resultsModel(tl: Timeline, i: number, ref: VarRef, hl: Highlight | null): ResultsModel {
  const snap = tl.snapshots[i];
  const obj = objAt(tl, ref, i);
  const elems = obj?.elems;
  const fmt = (s: Snapshot, v: V | undefined) => {
    const text = previewValue(tl, s, v, { depth: 1, maxItems: 4, maxString: 6 });
    return text.length > LATEST_MAX ? `${text.slice(0, LATEST_MAX - 1)}…` : text;
  };
  const widest = cached(widestCache, tl, `${ref.fnId}:${ref.name}`, () => {
    const last = tl.snapshots.length - 1;
    const final = objAt(tl, ref, last)?.elems?.toArray() ?? [];
    return Math.max(0, ...final.slice(-200).map((v) => fmt(tl.snapshots[last], v).length));
  });
  const count = elems?.size ?? 0;
  const found = Boolean(hl && !hl.reversed && obj && hl.diff.heap.some((h) => h.id === obj.id && h.op === 'push'));
  return { name: ref.name, count, latest: count ? fmt(snap, elems?.last()) : null, found, widest };
}

export function buildPanel(tl: Timeline, i: number, b: BacktrackBindings, info: TreeInfo, hl: Highlight | null): PanelModel {
  return {
    path: b.path ? pathRow(tl, i, b.path, hl) : null,
    board: b.board ? boardModel(tl, i, b.board, info, hl) : null,
    flags: b.flags ? flagsRow(tl, i, b.flags, hl) : null,
    results: b.results ? resultsModel(tl, i, b.results, hl) : null,
  };
}
