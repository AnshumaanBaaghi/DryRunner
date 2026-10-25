/** Plain-English narration of a step plus its evaluation chain (the HUD and the trace table's Event column). */
import type { AssignShape } from '../types/meta';
import type { CondEvent, ReturnEvent } from '../types/trace';
import type { V } from '../types/values';
import { frameById, visibleVars } from '../timeline/scope';
import type { Snapshot, StepRecord, Timeline, VarChange } from '../timeline/types';
import { previewValue, refId } from '../timeline/values';
import { keyText } from './changes';
import { exprTree, indexForm, subMap, tidy, valueForm } from './exprRender';

export type Tone = 'info' | 'call' | 'return' | 'true' | 'false' | 'error' | 'end' | 'warn';

export interface StepDescription {
  title: string;
  chain: string[];
  tone: Tone;
  output: string[];
}

export interface LoopStatus {
  loopId: number;
  line: number;
  kind: string;
  iteration: number;
  counters: [string, string][];
}

const COMPOUND = /^(\*\*|[-+*/%&|^]|<<|>>>?)=$/;

function fmtFor(tl: Timeline, snap: Snapshot) {
  return (v: V | undefined) => previewValue(tl, snap, v, { depth: 1, maxItems: 5, maxString: 24 });
}

export function fnLabel(tl: Timeline, fnId: number): string {
  const fn = tl.meta.fns[fnId];
  if (!fn) return 'function';
  if (fn.kind === 'ctor') return `new ${fn.className ?? fn.name}`;
  if (fn.kind === 'program') return 'top level';
  return fn.name;
}

export function callLabel(tl: Timeline, snap: Snapshot, callId: number): string {
  if (callId === 0) return 'the top level';
  const node = tl.calls.get(callId);
  if (!node) return 'a function';
  const fmt = (v: V) => previewValue(tl, snap, v, { depth: 0, maxString: 16 });
  return `${fnLabel(tl, node.fnId)}(${node.args.map(fmt).join(', ')})`;
}

function src(tl: Timeline, range: [number, number] | null | undefined): string {
  return range ? tidy(tl.meta.source.slice(range[0], range[1])) : '';
}

function chainOf(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) if (p && out[out.length - 1] !== p) out.push(p);
  return out;
}

function lastVarChange(tl: Timeline, i: number, name: string): VarChange | undefined {
  const vars = tl.diffs[i]?.vars ?? [];
  for (let k = vars.length - 1; k >= 0; k--) if (tl.meta.bindings[vars[k].bid]?.name === name) return vars[k];
  return undefined;
}

/** Destructuring assigns several targets at once: name each change (and call a two-slot exchange a swap). */
function patternTitle(tl: Timeline, i: number, step: StepRecord, snap: Snapshot, declared: boolean): string {
  const fmt = fmtFor(tl, snap);
  const diff = tl.diffs[i];
  const names = new Map<number, string>();
  for (const f of [frameById(snap, step.callId), snap.frames.first()]) {
    for (const v of f ? visibleVars(tl, f) : []) {
      const id = refId(v.slot.v);
      if (id !== null && !names.has(id)) names.set(id, v.name);
    }
  }
  const sets = (diff?.heap ?? []).filter((h) => h.op === 'set');
  const label = (h: (typeof sets)[number]) => `${names.get(h.id) ?? 'object'}${keyText(h.path)}`;
  const same = (a: V | undefined, b: V | undefined) => JSON.stringify(a) === JSON.stringify(b);
  if (sets.length === 2 && sets[0].id === sets[1].id && same(sets[0].old, sets[1].value) && same(sets[1].old, sets[0].value)) {
    return `Swapped ${label(sets[0])} and ${label(sets[1])}: ${fmt(sets[0].old)} ↔ ${fmt(sets[1].old)}`;
  }
  const parts = [
    ...(diff?.vars ?? []).map((c) => {
      const name = tl.meta.bindings[c.bid]?.name ?? '?';
      return c.kind === 'changed' && c.old !== undefined ? `${name}: ${fmt(c.old)} → ${fmt(c.value)}` : `${name} = ${fmt(c.value)}`;
    }),
    ...sets.map((h) => (h.old !== undefined ? `${label(h)}: ${fmt(h.old)} → ${fmt(h.value)}` : `${label(h)} = ${fmt(h.value)}`)),
  ];
  const list = `${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ', …' : ''}`;
  return `${declared ? 'Declared' : 'Assigned'} ${list || 'nothing new'}`;
}

function assignment(tl: Timeline, i: number, step: StepRecord, shape: AssignShape, snap: Snapshot): StepDescription {
  const fmt = fmtFor(tl, snap);
  const values = subMap(step.ev && 'sub' in step.ev ? step.ev.sub : undefined);
  const meta = tl.meta;
  const targetSrc = src(tl, shape.target);
  const targetIdx = tidy(indexForm(meta.source, exprTree(meta, step.sid, ...shape.target), values, fmt));
  const valueSrc = src(tl, shape.value);
  const rhs = shape.value ? tidy(valueForm(meta.source, exprTree(meta, step.sid, ...shape.value), values, fmt)) : '';
  const isIdent = /^[A-Za-z_$][\w$]*$/.test(targetSrc);
  const kind = meta.stmts[step.sid]?.kind;
  const declKw = kind === 'decl' || kind === 'loopInit' ? `${meta.source.slice(meta.stmts[step.sid].loc.start).match(/^(let|const|var)\b/)?.[1] ?? 'let'} ` : '';
  let newValue: V | undefined;
  let oldValue: V | undefined;
  if (isIdent) {
    const change = lastVarChange(tl, i, targetSrc);
    newValue = change?.value;
    oldValue = change?.old;
  } else {
    const heap = tl.diffs[i]?.heap ?? [];
    const set = [...heap].reverse().find((h) => h.op === 'set');
    newValue = set?.value;
    oldValue = set?.old;
  }
  const nv = newValue === undefined ? '' : fmt(newValue);
  const ov = oldValue === undefined ? '' : fmt(oldValue);
  let display: string;
  if (shape.value) display = `${declKw}${targetSrc} ${shape.op} ${valueSrc}`;
  else if (shape.op === '++' || shape.op === '--') display = shape.prefix ? `${shape.op}${targetSrc}` : `${targetSrc}${shape.op}`;
  else display = `${declKw}${targetSrc}`;
  let chain: string[];
  let title: string;
  if (shape.op === '++' || shape.op === '--') {
    chain = chainOf([display, `${targetIdx}: ${ov} → ${nv}`]);
    title = `${targetIdx} ${shape.op === '++' ? 'incremented' : 'decremented'}: ${ov} → ${nv}`;
  } else if (COMPOUND.test(shape.op)) {
    const op = shape.op.slice(0, -1);
    chain = chainOf([display, `${targetIdx} = ${ov} ${op} ${rhs} = ${nv}`]);
    title = `${targetIdx} updated: ${ov} → ${nv}`;
  } else if (shape.op === '=' && !shape.value) {
    chain = [display];
    title = `${targetSrc} declared (undefined)`;
  } else if (/^[[{]/.test(targetSrc)) {
    chain = chainOf([display, rhs ? `${targetIdx} = ${rhs}` : targetIdx]);
    title = patternTitle(tl, i, step, snap, Boolean(declKw));
  } else {
    const evaluated = rhs && rhs !== nv ? `${targetIdx} = ${rhs} = ${nv}` : `${targetIdx} = ${nv}`;
    chain = chainOf([display, evaluated]);
    if (declKw) title = `${targetSrc} declared: ${nv}`;
    else if (ov && ov !== nv) title = `${targetIdx} changed: ${ov} → ${nv}`;
    else title = `${targetIdx} set to ${nv}`;
  }
  return { title, chain, tone: 'info', output: [] };
}

function conditionChain(tl: Timeline, step: StepRecord, ev: CondEvent, snap: Snapshot): string[] {
  const fmt = fmtFor(tl, snap);
  const loc = tl.meta.stmts[step.sid]?.loc;
  if (!loc) return [];
  const source = tidy(tl.meta.source.slice(loc.start, loc.end));
  const evaluated = tidy(valueForm(tl.meta.source, exprTree(tl.meta, step.sid, loc.start, loc.end), subMap(ev.sub), fmt));
  return chainOf([source, evaluated, ev.kind === 'switch' ? fmt(ev.value) : String(ev.result)]);
}

export function loopStatus(tl: Timeline, i: number): LoopStatus[] {
  const step = tl.steps[i];
  const snap = tl.snapshots[i];
  if (!step || !snap) return [];
  const frame = frameById(snap, step.callId);
  const vars = frame ? visibleVars(tl, frame) : [];
  const fmt = fmtFor(tl, snap);
  return step.loops.map((l) => {
    const lm = tl.meta.loops[l.loopId];
    const counters: [string, string][] = [];
    for (const name of lm?.counters ?? []) {
      const v = vars.find((x) => x.name === name);
      if (v) counters.push([name, fmt(v.slot.v)]);
    }
    return { loopId: l.loopId, line: lm?.loc.line ?? 0, kind: lm?.kind ?? 'for', iteration: l.iteration, counters };
  });
}

export function describeStep(tl: Timeline, i: number): StepDescription {
  const step = tl.steps[i];
  const snap = tl.snapshots[i];
  if (!step || !snap) return { title: '', chain: [], tone: 'info', output: [] };
  const fmt = fmtFor(tl, snap);
  const output = (tl.diffs[i]?.logs ?? []).map((k) => tl.logs[k]?.text ?? '');
  const ev = step.ev;
  const meta = tl.meta;
  const stmt = step.sid >= 0 ? meta.stmts[step.sid] : undefined;
  const base = (title: string, tone: Tone, chain: string[] = []): StepDescription => ({ title, chain, tone, output });

  switch (step.kind) {
    case 'start':
      return base('Ready — press Step (→) to run the first statement.', 'info');
    case 'call': {
      if (ev?.t !== 'call') break;
      const fn = meta.fns[ev.fnId];
      const label = callLabel(tl, snap, ev.callId);
      const from = ev.parentId === 0 ? 'the top level' : callLabel(tl, snap, ev.parentId);
      const site = step.siteLoc ? ` (line ${step.siteLoc.line})` : '';
      if (fn?.isCallback) {
        const loops = loopStatus(tl, Math.max(0, i - 1));
        const it = loops.length ? ` — iteration ${loops[loops.length - 1].iteration}` : '';
        return base(`Callback ${label}${it}`, 'call');
      }
      return base(`${label} called from ${from}${site}`, 'call');
    }
    case 'return': {
      const r = ev as ReturnEvent;
      const label = callLabel(tl, snap, r.callId);
      const node = tl.calls.get(r.callId);
      const to = node && node.parentId !== 0 ? ` → back to ${callLabel(tl, snap, node.parentId)}` : '';
      let chain: string[] = [];
      if (!r.implicit && stmt?.value) {
        const valueSrc = src(tl, stmt.value);
        const evaluated = tidy(valueForm(meta.source, exprTree(meta, step.sid, ...stmt.value), subMap(r.sub), fmt));
        const v = fmt(r.value);
        chain = chainOf([`return ${valueSrc}`, evaluated !== v ? `${evaluated} = ${v}` : v]);
      }
      return base(`${label} returns ${fmt(r.value)}${to}`, 'return', chain);
    }
    case 'cond': {
      const c = ev as CondEvent;
      const line = step.line;
      if (c.kind === 'switch') return base(`switch at line ${line} on ${fmt(c.value)}`, 'info', conditionChain(tl, step, c, snap));
      if (c.kind === 'if') {
        return base(c.result ? `Condition is true — entering the if-block (line ${line})` : `Condition is false — skipping the block (line ${line})`,
          c.result ? 'true' : 'false', conditionChain(tl, step, c, snap));
      }
      const k = c.loop?.iteration ?? 0;
      const loopLine = meta.loops[c.loop?.loopId ?? -1]?.loc.line ?? line;
      if (stmt?.kind === 'forOf') {
        return base(`for…of at line ${loopLine}: no more elements — loop exits after ${k} iteration${k === 1 ? '' : 's'}`, 'false');
      }
      if (c.result) return base(`Loop at line ${loopLine} — iteration ${k}: check passes`, 'true', conditionChain(tl, step, c, snap));
      return base(`Loop at line ${loopLine}: check fails — exits after ${k} iteration${k === 1 ? '' : 's'}`, 'false', conditionChain(tl, step, c, snap));
    }
    case 'iter': {
      if (ev?.t !== 'iter') break;
      const names = (stmt?.declares ?? []).map((bid) => meta.bindings[bid]?.name ?? '?');
      const binds = ev.bindings.map((v, k) => `${names[k] ?? '_'} = ${fmt(v)}`).join(', ');
      const loopLine = meta.loops[ev.loop.loopId]?.loc.line ?? step.line;
      return base(`for…${stmt?.kind === 'forIn' ? 'in' : 'of'} at line ${loopLine} — iteration ${ev.loop.iteration}${binds ? `: ${binds}` : ''}`, 'true');
    }
    case 'stmt': {
      if (!stmt) break;
      if (stmt.kind === 'break' || stmt.kind === 'continue') {
        return base(stmt.kind === 'break' ? `break — leaving the loop (line ${step.line})` : `continue — jumping to the next iteration (line ${step.line})`, 'warn');
      }
      if (stmt.kind === 'throw') return base(`throw at line ${step.line}`, 'error', [tidy(meta.source.slice(stmt.loc.start, stmt.loc.end))]);
      if (stmt.kind === 'debugger') return base('debugger statement', 'info');
      if (stmt.assign) return { ...assignment(tl, i, step, stmt.assign, snap), output };
      const text = tidy(meta.source.slice(stmt.loc.start, stmt.loc.end)).replace(/;$/, '');
      if (stmt.kind === 'decl' || stmt.kind === 'loopInit') {
        const declared = (tl.diffs[i]?.vars ?? []).filter((v) => v.kind === 'new' && v.callId === step.callId)
          .map((v) => `${meta.bindings[v.bid]?.name ?? '?'} = ${fmt(v.value)}`);
        return base(declared.length ? `Declared ${declared.join(', ')}` : `Ran line ${step.line}`, 'info', [text]);
      }
      const values = subMap(ev && 'sub' in ev ? ev.sub : undefined);
      const tree = exprTree(meta, step.sid, stmt.loc.start, stmt.loc.end);
      // a bare call statement keeps its callee: console.log(climb(4)) → console.log(5)
      const only = tree.children.length === 1 ? tree.children[0] : null;
      const callRoot = only && (only.meta?.type === 'CallExpression' || only.meta?.type === 'OptionalCallExpression')
        ? { ...tree, children: only.children } : tree;
      const evaluated = tidy(valueForm(meta.source, callRoot, values, fmt)).replace(/;$/, '');
      if (output.length) return base(`Printed: ${output.join(' · ')}`, 'info', chainOf([text, evaluated]));
      return base(`Ran line ${step.line}`, 'info', chainOf([text, evaluated]));
    }
    case 'catch':
      return base(`Caught ${ev?.t === 'catch' ? fmt(ev.error) : 'an error'}`, 'warn');
    case 'error':
      return base(ev?.t === 'error' ? `${ev.name}: ${ev.message}${step.line ? ` (line ${step.line})` : ''}` : 'Error', 'error');
    case 'end': {
      const steps = tl.steps.length - 2;
      switch (tl.status) {
        case 'ok': return base('Program finished.', 'end');
        case 'error': return base(`Program stopped by an uncaught ${tl.endError?.name ?? 'error'}: ${tl.endError?.message ?? ''}`, 'error');
        case 'limit-steps': return base(`Stopped after ${steps.toLocaleString()} steps (step limit) — the trace so far is fully playable.`, 'warn');
        case 'limit-depth': return base('Stopped: maximum recursion depth exceeded — likely runaway recursion.', 'warn');
        case 'timeout': return base('Stopped: time limit reached — the trace so far is fully playable.', 'warn');
        default: return base('Running…', 'info');
      }
    }
  }
  return base(`Line ${step.line}`, 'info');
}
