/** Floating card describing the current step in plain English plus its evaluation chain. */
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CircleCheck, CircleX, CornerDownLeft, Info, PhoneCall, RotateCw, Terminal } from 'lucide-react';
import type { Tone } from '../../engine/describe/narrate';
import { useRun } from '../../state/runStore';
import { useDescription, useLoopStatus, useStepView } from '../../state/selectors';

const TONE: Record<Tone, { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: 'text-ink-dim' },
  call: { icon: PhoneCall, color: 'text-hl-visited' },
  return: { icon: CornerDownLeft, color: 'text-hl-done' },
  true: { icon: CircleCheck, color: 'text-hl-done' },
  false: { icon: CircleX, color: 'text-hl-error' },
  error: { icon: AlertTriangle, color: 'text-hl-error' },
  end: { icon: CircleCheck, color: 'text-hl-done' },
  warn: { icon: AlertTriangle, color: 'text-hl-changed' },
};

export function Hud() {
  const view = useStepView();
  const desc = useDescription(view);
  const loops = useLoopStatus(view);
  const compileError = useRun((s) => s.compileError);

  if (compileError) {
    return (
      <div className="pointer-events-auto max-w-xl rounded-xl border border-hl-error/40 bg-panel/95 p-3 shadow-2xl backdrop-blur" data-testid="hud">
        <div className="flex items-center gap-2 text-sm font-medium text-hl-error">
          <AlertTriangle size={16} /> Can't run this code
        </div>
        <div className="mt-1 font-mono text-xs text-ink">{compileError.message} <span className="text-ink-faint">(line {compileError.line})</span></div>
      </div>
    );
  }
  if (!view || !desc) return null;
  const tone = TONE[desc.tone];
  const Icon = tone.icon;
  return (
    <div className="pointer-events-auto max-w-[min(42rem,100%)] rounded-xl border border-line-strong bg-panel/92 p-3 shadow-2xl backdrop-blur" data-testid="hud">
      <div className="flex items-start gap-2">
        <Icon size={16} className={clsx('mt-0.5 shrink-0', tone.color)} />
        <div className="min-w-0">
          <div className="text-sm font-medium leading-snug text-ink" data-testid="hud-title">{desc.title}</div>
          {desc.chain.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[12.5px]" data-testid="hud-chain">
              {desc.chain.map((part, k) => (
                <span key={k} className="flex items-center gap-1.5">
                  {k > 0 && <ArrowRight size={12} className="text-ink-faint" />}
                  <span className={clsx('rounded px-1.5 py-0.5', k === desc.chain.length - 1 && desc.chain.length > 1
                    ? 'bg-hl-current/15 text-hl-current' : 'bg-panel-2 text-ink')}>{part}</span>
                </span>
              ))}
            </div>
          )}
          {loops.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="hud-loops">
              {loops.map((l, k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full border border-hl-window/30 bg-hl-window/10 px-2 py-0.5 text-[11px] text-hl-window">
                  <RotateCw size={11} /> Loop at line {l.line} — iteration {l.iteration}
                  {l.counters.length > 0 && <span className="font-mono text-ink"> · {l.counters.map(([n, v]) => `${n} = ${v}`).join(', ')}</span>}
                </span>
              ))}
            </div>
          )}
          {desc.output.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {desc.output.map((line, k) => (
                <div key={k} className="flex items-center gap-1.5 font-mono text-xs text-hl-done">
                  <Terminal size={12} /> {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
