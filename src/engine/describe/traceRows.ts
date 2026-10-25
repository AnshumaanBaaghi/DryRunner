/** Classic dry-run trace table: one row per step, one column per tracked variable; Markdown/CSV export. */
import { frameById, scopeChain, visibleVars } from '../timeline/scope';
import type { FrameSnap, Timeline, VarSlot } from '../timeline/types';
import { isFnValue, previewValue } from '../timeline/values';
import { changesForValue } from './changes';
import { callLabel, describeStep } from './narrate';

export interface TraceColumn {
  key: string;
  label: string;
  bids: number[];
}

export type CellState = 'new' | 'changed' | 'same' | 'heap' | 'none' | 'empty';

export interface TraceCell {
  text: string;
  state: CellState;
  old?: string;
  /** full value preview when `text` shows a heap change */
  full?: string;
}

export interface TraceRowData {
  step: number;
  line: number;
  kind: string;
  frame: string;
  loops: string;
  event: string;
  cells: Record<string, TraceCell>;
  output: string;
}

/** Variables in order of first appearance; same-named variables from different functions get `fn.name`. */
export function traceColumns(tl: Timeline): TraceColumn[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (const d of tl.diffs) {
    for (const c of d.vars) {
      if (seen.has(c.bid) || isFnValue(c.value)) continue;
      const b = tl.meta.bindings[c.bid];
      if (!b || b.kind === 'function' || b.kind === 'class') continue;
      seen.add(c.bid);
      order.push(c.bid);
    }
  }
  const byName = new Map<string, number[]>();
  for (const bid of order) {
    const name = tl.meta.bindings[bid].name;
    byName.set(name, [...(byName.get(name) ?? []), bid]);
  }
  const columns: TraceColumn[] = [];
  for (const [name, bids] of byName) {
    const fnIds = [...new Set(bids.map((b) => tl.meta.bindings[b].fnId))];
    if (fnIds.length <= 1) {
      columns.push({ key: name, label: name, bids });
      continue;
    }
    for (const fnId of fnIds) {
      const fn = tl.meta.fns[fnId];
      const label = fnId === 0 ? name : `${fn?.name ?? 'fn'}.${name}`;
      columns.push({ key: label, label, bids: bids.filter((b) => tl.meta.bindings[b].fnId === fnId) });
    }
  }
  return columns;
}

export function traceRow(tl: Timeline, i: number, columns: TraceColumn[]): TraceRowData {
  const step = tl.steps[i];
  const snap = tl.snapshots[i];
  const diff = tl.diffs[i];
  const frame = frameById(snap, step.callId) ?? (snap.frames.last() as FrameSnap);
  const chain = scopeChain(snap, frame);
  const visible = new Map<number, { slot: VarSlot; callId: number }>();
  for (const f of chain) for (const v of visibleVars(tl, f)) if (!visible.has(v.bid)) visible.set(v.bid, { slot: v.slot, callId: f.callId });
  const fmt = (v: VarSlot['v']) => previewValue(tl, snap, v, { depth: 2, maxItems: 8, maxString: 24 });
  const cells: Record<string, TraceCell> = {};
  for (const col of columns) {
    const bid = col.bids.find((b) => visible.has(b));
    if (bid === undefined) {
      cells[col.key] = { text: '', state: 'empty' };
      continue;
    }
    const { slot, callId } = visible.get(bid) as { slot: VarSlot; callId: number };
    const change = diff.vars.findLast((c) => c.bid === bid && c.callId === callId);
    const heap = change ? [] : changesForValue(tl, snap, diff, slot.v, 2);
    // for a mutated array/object the useful thing to show is *what* changed: dp[1][4]: 0 → 1
    const heapText = heap.map((h) => `${col.label}${h.prefix}${h.text.startsWith('[') || h.text.startsWith('.') ? '' : '.'}${h.text}`).join('; ');
    cells[col.key] = {
      text: heap.length ? heapText : fmt(slot.v),
      state: change ? change.kind : heap.length ? 'heap' : 'none',
      ...(change?.kind === 'changed' && change.old !== undefined ? { old: fmt(change.old) } : {}),
      ...(heap.length ? { full: fmt(slot.v) } : {}),
    };
  }
  const desc = describeStep(tl, i);
  const loops = step.loops.map((l) => `L${tl.meta.loops[l.loopId]?.loc.line ?? '?'}#${l.iteration}`).join(' ');
  return {
    step: i,
    line: step.line,
    kind: step.kind,
    frame: step.callId === 0 ? '' : callLabel(tl, snap, step.callId),
    loops,
    event: desc.chain.length ? desc.chain.join(' → ') : desc.title,
    cells,
    output: desc.output.join(' · '),
  };
}

const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const csvEscape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function cellText(c: TraceCell | undefined, mark: boolean): string {
  if (!c || c.state === 'empty') return '';
  if (!mark) return c.text;
  if (c.state === 'changed') return `**${c.text}**${c.old !== undefined ? ` (was ${c.old})` : ''}`;
  if (c.state === 'new' || c.state === 'heap') return `**${c.text}**`;
  return c.text;
}

export function toMarkdown(columns: TraceColumn[], rows: TraceRowData[]): string {
  const head = ['Step', 'Line', 'Frame', 'Loops', 'Event', ...columns.map((c) => c.label), 'Output'];
  const lines = [`| ${head.map(mdEscape).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) {
    const cells = [String(r.step), r.line ? String(r.line) : '', r.frame, r.loops, r.event, ...columns.map((c) => cellText(r.cells[c.key], true)), r.output];
    lines.push(`| ${cells.map(mdEscape).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function toCSV(columns: TraceColumn[], rows: TraceRowData[]): string {
  const head = ['step', 'line', 'frame', 'loops', 'event', ...columns.map((c) => c.label), 'output'];
  const lines = [head.map(csvEscape).join(',')];
  for (const r of rows) {
    const cells = [String(r.step), r.line ? String(r.line) : '', r.frame, r.loops, r.event, ...columns.map((c) => cellText(r.cells[c.key], false)), r.output];
    lines.push(cells.map(csvEscape).join(','));
  }
  return lines.join('\n');
}
