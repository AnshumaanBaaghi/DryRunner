import clsx from 'clsx';
import {
  ArrowDownToLine, ArrowUpFromLine, Pause, Play, Redo2, Repeat, SkipBack, SkipForward, StepBack, StepForward, Table2,
} from 'lucide-react';
import { Slider } from 'radix-ui';
import { useMemo } from 'react';
import { breakpointSteps } from '../../engine/timeline/navigation';
import { useEditor } from '../../state/editorStore';
import { usePlayback } from '../../state/playbackStore';
import { useRun } from '../../state/runStore';
import { useMediaQuery, useStepView } from '../../state/selectors';
import { useUi } from '../../state/uiStore';
import { IconButton, Tip } from '../primitives';

function SpeedControl() {
  const speed = usePlayback((s) => s.speed);
  const setSpeed = usePlayback((s) => s.setSpeed);
  const value = Math.log2(speed);
  return (
    <div className="flex items-center gap-2" data-testid="speed">
      <Tip label="Playback speed">
        <span className="w-10 text-right font-mono text-xs text-ink-dim tabular-nums">{speed < 1 ? speed.toFixed(2) : speed.toFixed(speed % 1 ? 1 : 0)}×</span>
      </Tip>
      <Slider.Root
        className="relative flex h-5 w-24 touch-none items-center select-none"
        min={-2}
        max={2}
        step={0.25}
        value={[value]}
        onValueChange={([v]) => setSpeed(Math.round(2 ** v * 100) / 100)}
        aria-label="Playback speed"
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-line-strong">
          <Slider.Range className="absolute h-full rounded-full bg-ink-faint" />
        </Slider.Track>
        <Slider.Thumb className="block h-3.5 w-3.5 rounded-full bg-ink shadow focus-visible:outline-2 focus-visible:outline-hl-current" />
      </Slider.Root>
    </div>
  );
}

function Scrubber() {
  const view = useStepView();
  const goto = usePlayback((s) => s.goto);
  const setScrubbing = usePlayback((s) => s.setScrubbing);
  const breakpoints = useEditor((s) => s.breakpoints);
  const last = view?.last ?? 0;
  const markers = useMemo(() => {
    if (!view) return { bps: [] as number[], errors: [] as number[] };
    const lines = new Set(breakpoints.map((b) => b.line));
    return { bps: breakpointSteps(view.tl, lines, 300), errors: view.tl.errors.map((e) => e.step) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.tl, view?.version, breakpoints]);
  const pct = (i: number) => (last > 0 ? (i / last) * 100 : 0);
  return (
    <div className="relative flex min-w-0 flex-1 items-center" data-testid="scrubber">
      <div className="pointer-events-none absolute inset-x-[7px] top-1/2 h-3 -translate-y-1/2">
        {markers.bps.map((s) => (
          <span key={`b${s}`} className="absolute top-0 h-3 w-0.5 -translate-x-1/2 rounded bg-hl-error/80" style={{ left: `${pct(s)}%` }} />
        ))}
        {markers.errors.map((s) => (
          <span key={`e${s}`} className="absolute top-0.5 h-2 w-2 -translate-x-1/2 rotate-45 bg-hl-error" style={{ left: `${pct(s)}%` }} />
        ))}
      </div>
      <input
        type="range"
        className="as-range relative"
        min={0}
        max={last}
        step={1}
        value={view?.i ?? 0}
        disabled={!view}
        aria-label="Timeline"
        onPointerDown={() => setScrubbing(true)}
        onPointerUp={() => setScrubbing(false)}
        onChange={(e) => goto(Number(e.target.value), 'jump')}
      />
    </div>
  );
}

export function PlaybackBar() {
  const view = useStepView();
  const playing = usePlayback((s) => s.playing);
  const pb = usePlayback.getState();
  const status = useRun((s) => s.status);
  const runStatus = useRun((s) => s.timeline?.status);
  const mobile = useMediaQuery('(max-width: 899px)');
  const tableOpen = useUi((s) => (mobile ? s.sheetOpen : s.tableOpen));
  const setTableOpen = useUi((s) => (mobile ? s.setSheetOpen : s.setTableOpen));
  const has = Boolean(view);
  const atStart = !view || view.i === 0;
  const atEnd = !view || view.i >= view.last;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-panel px-2 py-1 sm:h-12 sm:flex-nowrap sm:gap-3 sm:px-3 sm:py-0" data-testid="playback">
      <div className="flex w-full items-center justify-between sm:w-auto sm:justify-start">
        <IconButton label="Go to start" onClick={pb.toStart} disabled={atStart}><SkipBack size={16} /></IconButton>
        <IconButton label="Step back" shortcut="←" onClick={pb.back} disabled={atStart} data-testid="step-back"><StepBack size={16} /></IconButton>
        <IconButton label={playing ? 'Pause' : 'Play'} shortcut="Space" onClick={pb.toggle} disabled={!has} data-testid="play"
          className="h-9 w-9 bg-raised text-ink hover:bg-line-strong">
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </IconButton>
        <IconButton label="Step" shortcut="→" onClick={pb.forward} disabled={atEnd} data-testid="step-forward"><StepForward size={16} /></IconButton>
        <IconButton label="Step over" shortcut="⇧→" onClick={pb.over} disabled={atEnd} data-testid="step-over"><Redo2 size={16} /></IconButton>
        <IconButton label="Step into" shortcut="↓" onClick={pb.into} disabled={atEnd} data-testid="step-into"><ArrowDownToLine size={16} /></IconButton>
        <IconButton label="Step out" shortcut="↑" onClick={pb.out} disabled={atEnd} data-testid="step-out"><ArrowUpFromLine size={16} /></IconButton>
        <IconButton label="Next iteration" shortcut="N" onClick={pb.nextIter} disabled={atEnd} data-testid="next-iter"><Repeat size={16} /></IconButton>
        <IconButton label="Go to end" onClick={pb.toEnd} disabled={atEnd}><SkipForward size={16} /></IconButton>
      </div>
      <div className="hidden md:block"><SpeedControl /></div>
      <Scrubber />
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={clsx('hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline',
            status === 'running' && 'animate-pulse bg-hl-visited/20 text-hl-visited',
            runStatus === 'limit-steps' || runStatus === 'timeout' || runStatus === 'limit-depth' ? 'bg-hl-changed/15 text-hl-changed' : '',
            runStatus === 'error' && 'bg-hl-error/15 text-hl-error')}
        >
          {status === 'running' ? 'running…' : runStatus === 'limit-steps' ? 'step limit' : runStatus === 'timeout' ? 'timeout'
            : runStatus === 'limit-depth' ? 'depth limit' : runStatus === 'error' ? 'error' : ''}
        </span>
        <span className="font-mono text-xs text-ink-dim tabular-nums" data-testid="step-counter">
          Step {view?.i ?? 0} / {view?.last ?? 0}
        </span>
        <IconButton label={tableOpen ? 'Hide trace table' : 'Show trace table'} onClick={() => setTableOpen(!tableOpen)} active={tableOpen} data-testid="toggle-table">
          <Table2 size={16} />
        </IconButton>
      </div>
    </div>
  );
}
