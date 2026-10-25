/**
 * Center stage: the lazily loaded 3D canvas with the HUD and stage controls on top. In full screen it
 * covers the window and carries its own playback bar.
 */
import clsx from 'clsx';
import { AlertTriangle, Loader2, Minimize2, MousePointerClick } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRun } from '../../state/runStore';
import { useUi } from '../../state/uiStore';
import { CONTROLS_INSET, useViz } from '../../state/vizStore';
import { ErrorBoundary } from '../ErrorBoundary';
import { Hud } from '../hud/Hud';
import { PlaybackBar } from '../playback/PlaybackBar';
import { Button, IconButton } from '../primitives';
import { exitStageFullscreen } from './fullscreen';
import { StageToolbar } from './StageToolbar';

const Stage = lazy(() => import('../../scene/Stage'));

function Backdrop() {
  return (
    <div
      className="absolute inset-0 opacity-60"
      style={{
        backgroundImage:
          'radial-gradient(circle at 50% 35%, rgba(59,130,246,0.10), transparent 55%), linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 32px 32px, 32px 32px',
      }}
    />
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center p-6 text-center">{children}</div>;
}

function StageFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice>
      <div className="max-w-sm space-y-3 text-ink-dim" data-testid="stage-error">
        <AlertTriangle className="mx-auto text-hl-error" size={26} />
        <div className="text-sm">The 3D view stopped: {message}</div>
        <div className="text-xs text-ink-faint">The dry run, variables and trace table keep working.</div>
        <Button onClick={onRetry}>Restart 3D view</Button>
      </div>
    </Notice>
  );
}

/** Reports how much of the stage the HUD covers, so the camera keeps the scene below it. */
function useHudInset() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => useViz.getState().setHudInset(el.offsetTop + el.offsetHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, []);
  return ref;
}

/** In full screen the playback bar sits under the stage controls; the camera keeps the scene above both. */
function useBarInset(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const { setBottomInset } = useViz.getState();
    const report = () => setBottomInset(CONTROLS_INSET + 8 + el.offsetHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => {
      ro.disconnect();
      setBottomInset(CONTROLS_INSET);
    };
  }, [on]);
  return ref;
}

export function StageArea() {
  const hudRef = useHudInset();
  const fullscreen = useUi((s) => s.stageFullscreen);
  const barRef = useBarInset(fullscreen !== 'off');
  const timeline = useRun((s) => s.timeline);
  const status = useRun((s) => s.status);
  const [epoch, setEpoch] = useState(0);
  const [lost, setLost] = useState(false);
  const restart = () => {
    setLost(false);
    setEpoch((e) => e + 1);
  };
  return (
    <div className={clsx('overflow-hidden bg-bg', fullscreen === 'off' ? 'relative h-full min-h-0' : 'fixed inset-0 z-40')}
      data-testid="stage" data-fullscreen={fullscreen}>
      {!timeline ? (
        <>
          <Backdrop />
          {status !== 'compiling' && (
            <Notice>
              <div className="pointer-events-none max-w-sm space-y-2 text-ink-faint">
                <MousePointerClick className="mx-auto" size={28} />
                <div className="text-sm">Pick an example or paste your JavaScript, then press <b className="text-ink-dim">Visualize</b> (⌘/Ctrl + Enter).</div>
              </div>
            </Notice>
          )}
        </>
      ) : lost ? (
        <StageFailure message="the graphics context was lost." onRetry={restart} />
      ) : (
        <ErrorBoundary key={epoch} fallback={(error) => <StageFailure message={error.message} onRetry={restart} />}>
          <Suspense fallback={<Notice><Loader2 className="animate-spin text-ink-faint" size={22} /></Notice>}>
            <div className="absolute inset-0" data-testid="stage-canvas">
              <Stage onContextLost={() => setLost(true)} />
            </div>
          </Suspense>
        </ErrorBoundary>
      )}
      <div ref={hudRef} className={clsx('pointer-events-none absolute inset-x-3 top-3 flex', fullscreen !== 'off' && 'pr-11')}>
        <Hud />
      </div>
      {fullscreen !== 'off' && (
        <div className="absolute right-3 top-3 rounded-lg border border-line bg-panel/85 p-0.5 backdrop-blur">
          <IconButton label="Exit full screen" shortcut="Esc" onClick={exitStageFullscreen} data-testid="stage-exit-fullscreen">
            <Minimize2 size={15} />
          </IconButton>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col gap-2">
        {timeline && !lost && <StageToolbar />}
        {fullscreen !== 'off' && (
          <div ref={barRef} className="pointer-events-auto">
            <PlaybackBar variant="stage" />
          </div>
        )}
      </div>
    </div>
  );
}
