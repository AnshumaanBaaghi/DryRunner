/** Program output up to the current step; the current step's lines are highlighted, click jumps there. */
import clsx from 'clsx';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayback } from '../../state/playbackStore';
import { useStepView } from '../../state/selectors';
import { IconButton, PanelHeader } from '../primitives';

const LEVEL: Record<string, string> = {
  error: 'text-hl-error',
  warn: 'text-hl-changed',
  info: 'text-hl-visited',
  debug: 'text-ink-faint',
  log: 'text-ink',
};

export function ConsolePanel() {
  const view = useStepView();
  const goto = usePlayback((s) => s.goto);
  const [showFuture, setShowFuture] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const logs = useMemo(() => view?.tl.logs ?? [], [view]);
  const current = view?.i ?? 0;
  const visible = showFuture ? logs : logs.filter((l) => l.step <= current);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-current="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="console">
      <PanelHeader title={`Console${logs.length ? ` · ${visible.length}/${logs.length}` : ''}`}>
        <IconButton label={showFuture ? 'Hide output after this step' : 'Show all output'} onClick={() => setShowFuture(!showFuture)}>
          {showFuture ? <EyeOff size={14} /> : <Eye size={14} />}
        </IconButton>
      </PanelHeader>
      <div ref={listRef} className="as-scroll min-h-0 flex-1 overflow-auto py-1 font-mono text-[12.5px]">
        {visible.length === 0 && <div className="px-3 py-2 text-xs text-ink-faint">{logs.length ? 'No output yet at this step.' : 'console.log output appears here.'}</div>}
        {visible.map((l, k) => (
          <button
            type="button"
            key={k}
            data-current={l.step === current}
            onClick={() => goto(l.step, 'jump')}
            className={clsx(
              'flex w-full items-start gap-2 px-3 py-0.5 text-left hover:bg-raised',
              l.step === current && 'as-flash',
              l.step > current && 'opacity-40',
            )}
          >
            <span className="w-10 shrink-0 text-right text-[10px] leading-5 text-ink-faint">#{l.step}</span>
            <span className={clsx('whitespace-pre-wrap break-all leading-5', LEVEL[l.level] ?? 'text-ink')}>{l.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
