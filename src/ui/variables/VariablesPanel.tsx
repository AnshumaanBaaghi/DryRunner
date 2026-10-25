/** Right panel: current frame locals, globals, active loops, call stack and watches. */
import clsx from 'clsx';
import { Layers, RotateCw } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { callLabel } from '../../engine/describe/narrate';
import { frameById, visibleVars } from '../../engine/timeline/scope';
import type { FrameSnap } from '../../engine/timeline/types';
import { useLoopStatus, useStepView } from '../../state/selectors';
import { PanelHeader } from '../primitives';
import { FrameVars } from './FrameVars';
import { WatchList } from './WatchList';

function Section({ title, children, testId }: { title: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="border-b border-line px-1.5 py-2" data-testid={testId}>
      <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{title}</div>
      {children}
    </section>
  );
}

export function VariablesPanel() {
  const view = useStepView();
  const loops = useLoopStatus(view);
  const frame = useMemo(() => (view ? frameById(view.snap, view.step.callId) ?? (view.snap.frames.last() as FrameSnap) : null), [view]);
  const prevVisible = useMemo(() => {
    if (!view || view.i === 0 || !frame) return undefined;
    const prevStep = view.tl.steps[view.i - 1];
    if (prevStep.callId !== frame.callId) return undefined;
    const prevFrame = frameById(view.tl.snapshots[view.i - 1], frame.callId);
    return prevFrame ? visibleVars(view.tl, prevFrame) : undefined;
  }, [view, frame]);
  const main = view?.snap.frames.first() as FrameSnap | undefined;
  const stack = view ? view.snap.frames.toArray().reverse() : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="variables">
      <PanelHeader title="Variables" />
      <div className="as-scroll min-h-0 flex-1 overflow-auto">
        {!view || !frame ? (
          <div className="p-3 text-xs text-ink-faint">Run a program to inspect its variables step by step.</div>
        ) : (
          <>
            <Section title={frame.callId === 0 ? 'Top level' : `Locals · ${callLabel(view.tl, view.snap, frame.callId)}`} testId="locals">
              <FrameVars view={view} frame={frame} prevVisible={prevVisible} />
            </Section>
            {main && frame.callId !== 0 && visibleVars(view.tl, main).length > 0 && (
              <Section title="Globals">
                <FrameVars view={view} frame={main} />
              </Section>
            )}
            {loops.length > 0 && (
              <Section title="Active loops" testId="loops">
                {loops.map((l, k) => (
                  <div key={k} className="flex items-center gap-2 px-2 py-0.5 text-xs">
                    <RotateCw size={12} className="text-hl-window" />
                    <span className="text-ink-dim">line {l.line}</span>
                    <span className="rounded bg-hl-window/10 px-1.5 font-mono text-hl-window">iteration {l.iteration}</span>
                    <span className="font-mono text-ink">{l.counters.map(([n, v]) => `${n}=${v}`).join(' ')}</span>
                  </div>
                ))}
              </Section>
            )}
            <Section title={<span className="inline-flex items-center gap-1"><Layers size={11} /> Call stack · {stack.length}</span>} testId="callstack">
              {stack.slice(0, 50).map((f, k) => (
                <div key={f.callId} className={clsx('flex items-center gap-2 rounded px-2 py-0.5 font-mono text-[12px]',
                  k === 0 ? 'bg-hl-current/10 text-hl-current' : 'text-ink-dim')}>
                  <span className="w-4 text-right text-[10px] text-ink-faint">{stack.length - 1 - k}</span>
                  <span className="truncate">{f.callId === 0 ? '(top level)' : callLabel(view.tl, view.snap, f.callId)}</span>
                  {f.status === 'returning' && f.returning !== undefined && <span className="text-hl-done">→ returning</span>}
                </div>
              ))}
              {stack.length > 50 && <div className="px-2 text-[11px] text-ink-faint">… {stack.length - 50} more frames</div>}
            </Section>
          </>
        )}
        <Section title="Watch">
          <WatchList view={view} />
        </Section>
      </div>
    </div>
  );
}
