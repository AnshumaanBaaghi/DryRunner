/** Modal dialogs: entry-call picker, settings, breakpoint condition. Forms reset by remounting (key). */
import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import type { StaticAnalysis } from '../../engine/types/meta';
import type { RunLimits } from '../../engine/types/trace';
import { useEditor } from '../../state/editorStore';
import { useRun } from '../../state/runStore';
import { useUi } from '../../state/uiStore';
import { useViz, type Quality } from '../../state/vizStore';
import { Button } from '../primitives';

function Shell({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-panel p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-sm text-ink-dim">{description}</Dialog.Description>}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const inputClass = 'w-full rounded-md border border-line-strong bg-panel-2 px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-hl-current/60';

type EntryFn = StaticAnalysis['functions'][number];

function EntryForm({ fn, onClose }: { fn: EntryFn; onClose: () => void }) {
  const [args, setArgs] = useState<string[]>(() => fn.params.map(() => ''));
  const callee = fn.className ? `new ${fn.className}().${fn.name}` : fn.name;
  const call = `${callee}(${args.map((a) => a.trim() || 'undefined').join(', ')})`;
  return (
    <>
      {fn.params.map((p, k) => (
        <label key={k} className="block">
          <span className="mb-1 block font-mono text-xs text-ink-dim">{p}</span>
          <input className={inputClass} value={args[k]} placeholder="e.g. [1, 2, 3] or 'abc' or 5"
            onChange={(e) => setArgs(args.map((a, j) => (j === k ? e.target.value : a)))} />
        </label>
      ))}
      <div className="rounded-md bg-panel-2 px-3 py-2 font-mono text-xs text-hl-current">console.log({call});</div>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" data-testid="entry-run" onClick={() => {
          const code = useEditor.getState().code.replace(/\s*$/, '');
          useEditor.getState().setCode(`${code}\n\n// entry call added by AlgoScope\nconsole.log(${call});\n`);
          onClose();
          void useRun.getState().visualize({ skipEntryCheck: true });
        }}>Add call & visualize</Button>
      </div>
    </>
  );
}

function EntryDialog() {
  const fns = useUi((s) => s.entryFunctions);
  const close = useUi((s) => s.closeEntryDialog);
  const [index, setIndex] = useState(0);
  const fn = fns?.[Math.min(index, (fns?.length ?? 1) - 1)];
  if (!fns || !fn) return null;
  return (
    <Shell open onOpenChange={(o) => !o && close()} title="Which function should run?"
      description="Your code defines functions but never calls one. Pick a function and its inputs — the call is added to the end of your code.">
      <div className="space-y-3" data-testid="entry-dialog">
        <select className={inputClass} value={index} onChange={(e) => setIndex(Number(e.target.value))} aria-label="Function">
          {fns.map((f, k) => <option key={k} value={k}>{f.className ? `${f.className}.` : ''}{f.name}({f.params.join(', ')})</option>)}
        </select>
        <EntryForm key={`${index}:${fn.name}`} fn={fn} onClose={close} />
      </div>
    </Shell>
  );
}

function SettingsForm({ initial, onClose }: { initial: RunLimits; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [stage, setStage] = useState(() => ({ quality: useViz.getState().quality, follow: useViz.getState().follow }));
  const field = (label: string, key: keyof RunLimits, min: number, max: number, hint: string, scale = 1) => (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs text-ink-dim"><span>{label}</span><span className="text-ink-faint">{hint}</span></span>
      <input type="number" className={inputClass} min={min} max={max} value={draft[key] / scale}
        onChange={(e) => setDraft({ ...draft, [key]: Math.round(Math.min(max, Math.max(min, Number(e.target.value) || min)) * scale) })} />
    </label>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {field('Max steps', 'maxSteps', 100, 200_000, '100 – 200k')}
        {field('Max recursion depth', 'maxDepth', 10, 5_000, '10 – 5k')}
        {field('Time limit (s)', 'timeoutMs', 0.5, 10, '0.5 – 10 s', 1000)}
        {field('Random seed', 'seed', 0, 2_147_483_647, 'Math.random')}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-dim">3D quality</span>
          <select className={inputClass} value={stage.quality} data-testid="settings-quality"
            onChange={(e) => setStage({ ...stage, quality: e.target.value as Quality })}>
            <option value="high">High — bloom, soft shadows</option>
            <option value="low">Low — faster</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" checked={stage.follow} data-testid="settings-follow"
            onChange={(e) => setStage({ ...stage, follow: e.target.checked })} />
          Camera follows changes
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => {
          useRun.getState().setLimits(draft);
          useViz.getState().setQuality(stage.quality);
          useViz.getState().setFollow(stage.follow);
          onClose();
        }}>Save</Button>
      </div>
    </>
  );
}

function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const limits = useRun((s) => s.limits);
  return (
    <Shell open={open} onOpenChange={setOpen} title="Settings" description="Limits keep runaway code from freezing the tab; the trace up to a limit stays playable.">
      {open && <SettingsForm initial={limits} onClose={() => setOpen(false)} />}
    </Shell>
  );
}

function ConditionForm({ line, initial, hasBreakpoint, onClose }: { line: number; initial: string; hasBreakpoint: boolean; onClose: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      useEditor.getState().setBreakpointCondition(line, text);
      onClose();
    }}>
      <input autoFocus className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="condition (empty = always pause)" />
      <div className="flex justify-between gap-2">
        <Button variant="danger" onClick={() => {
          if (hasBreakpoint) useEditor.getState().toggleBreakpoint(line);
          onClose();
        }}>Remove breakpoint</Button>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit">Save</Button>
        </div>
      </div>
    </form>
  );
}

function ConditionDialog() {
  const line = useUi((s) => s.conditionLine);
  const existing = useEditor((s) => s.breakpoints.find((b) => b.line === line));
  const close = () => useUi.getState().editCondition(null);
  if (line === null) return null;
  return (
    <Shell open onOpenChange={(o) => !o && close()} title={`Breakpoint on line ${line}`}
      description="Pause only when this expression is true, evaluated in that line's scope just before it runs (e.g. i === 3).">
      <ConditionForm key={line} line={line} initial={existing?.condition ?? ''} hasBreakpoint={Boolean(existing)} onClose={close} />
    </Shell>
  );
}

export function Dialogs() {
  return (
    <>
      <EntryDialog />
      <SettingsDialog />
      <ConditionDialog />
    </>
  );
}
