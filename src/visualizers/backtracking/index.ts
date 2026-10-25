/** Backtracking visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import { valueAt, type VarRef } from '../../engine/detect/track';
import type { HeapChange, Snapshot, Timeline } from '../../engine/timeline/types';
import { previewValue, primitive, refId } from '../../engine/timeline/values';
import { sameV, type V } from '../../engine/types/values';
import { buildCallTree, callText, constantArgs } from '../shared/callTree';
import type { Detection, Visualizer } from '../types';
import { detectBacktracking, type BacktrackBindings } from './detect';
import { boardRows, short, treeInfo } from './model';

const BacktrackingView = lazy(() => import('./BacktrackingView').then((m) => ({ default: m.BacktrackingView })));

const pv = (tl: Timeline, snap: Snapshot, v: V | undefined) => previewValue(tl, snap, v, { depth: 1, maxItems: 8, maxString: 12 });

/** A board piece by name: 'Q' is a queen, anything else its value. */
function piece(tl: Timeline, snap: Snapshot, v: V | undefined): string {
  const p = primitive(tl, v);
  return p.value === 'Q' || p.value === 'q' ? 'queen' : pv(tl, snap, v);
}

function flagLine(tl: Timeline, snap: Snapshot, name: string, h: HeapChange): string | null {
  const at = `${name}[${typeof h.path[0] === 'number' ? h.path[0] : `'${String(h.path[0])}'`}]`;
  switch (h.op) {
    case 'set': return h.value === true ? `mark ${at}` : h.value === false ? `unmark ${at}` : `${at} = ${pv(tl, snap, h.value)}`;
    case 'delete': return `unmark ${at}`;
    case 'setAdd': return `add ${pv(tl, snap, h.key)} to ${name}`;
    case 'setDelete': return `remove ${pv(tl, snap, h.key)} from ${name}`;
    case 'mapSet': return `${name}.set(${pv(tl, snap, h.key)}, ${pv(tl, snap, h.value)})`;
    case 'mapDelete': return `${name}.delete(${pv(tl, snap, h.key)})`;
    default: return null;
  }
}

/** HUD lines: the choice made or undone at this step, a solution found, a call backing out of a dead end. */
function describe(tl: Timeline, i: number, d: Detection<BacktrackBindings>): string[] {
  if (i === 0) return [];
  const b = d.bindings;
  const tree = buildCallTree(tl, b.fnIds);
  const info = treeInfo(tl, tree, b);
  const snap = tl.snapshots[i];
  const idOf = (ref: VarRef | undefined) => (ref ? refId(valueAt(tl, ref, i)) : null);
  const pathId = idOf(b.path);
  const flagsId = idOf(b.flags);
  const rows = b.board ? boardRows(tl, b.board, i) : [];
  const out: string[] = [];
  for (const h of tl.diffs[i].heap) {
    if (b.path && h.id === pathId && (h.op === 'push' || h.op === 'pop')) {
      const what = h.op === 'push' ? (h.args ?? []).map((v) => short(tl, snap, v, 8)).join(',') : short(tl, snap, h.old, 8);
      out.push(`${h.op === 'push' ? 'choose' : 'undo'} +${what} → ${b.path.name} ${pv(tl, snap, valueAt(tl, b.path, i))}`);
    } else if (b.board && h.op === 'set' && typeof h.path[0] === 'number' && rows.includes(h.id)) {
      const cell = `(${rows.indexOf(h.id)},${h.path[0]})`;
      const rest = info.resting.get(`${h.id}:${h.path[0]}`);
      const removed = rest !== undefined && h.value !== undefined && sameV(h.value, rest);
      out.push(removed ? `remove ${piece(tl, snap, h.old)} from ${cell}` : `place ${piece(tl, snap, h.value)} at ${cell}`);
    } else if (b.flags && h.id === flagsId) {
      const line = flagLine(tl, snap, b.flags.name, h);
      if (line) out.push(line);
    }
  }
  const found = info.solutionSteps.indexOf(i);
  if (found >= 0) out.push(`solution #${found + 1} found`);
  const step = tl.steps[i];
  const node = step.kind === 'return' ? tree.nodes.get(step.callId) : undefined;
  if (node && b.results && info.barren.has(node.callId)) {
    out.push(`dead end: ${callText(tl, snap, node, constantArgs(tree).get(node.fnId))} backtracks`);
  }
  return out;
}

export const backtrackingVisualizer: Visualizer<BacktrackBindings> = {
  id: 'backtracking',
  label: 'Backtracking',
  detect: detectBacktracking,
  Component: BacktrackingView,
  describe,
  // an upright tree and board, like the recursion tree
  cameraTilt: 0.16,
};
