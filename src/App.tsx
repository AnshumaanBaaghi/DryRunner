import { Tooltip } from 'radix-ui';
import { useEffect } from 'react';
import { sandbox } from './engine/sandbox/instance';
import { useRun } from './state/runStore';
import { AppShell } from './ui/AppShell';
import { ErrorBoundary } from './ui/ErrorBoundary';

function AppFailure({ error }: { error: Error }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center" data-testid="app-error">
      <div className="max-w-md space-y-3">
        <div className="text-lg font-semibold text-ink">AlgoScope hit an unexpected error</div>
        <div className="font-mono text-xs text-hl-error">{error.message}</div>
        <div className="text-sm text-ink-dim">Your code is kept in this browser. Reload to continue.</div>
        <button type="button" onClick={() => window.location.reload()}
          className="rounded-md bg-hl-current px-3 py-1.5 text-sm font-medium text-black hover:brightness-110">
          Reload
        </button>
      </div>
    </div>
  );
}

export function App() {
  useEffect(() => {
    sandbox().warmUp();
    // show something immediately: dry-run whatever is in the editor (never pops dialogs)
    void useRun.getState().visualize({ auto: true });
  }, []);
  return (
    <ErrorBoundary fallback={(error) => <AppFailure error={error} />}>
      <Tooltip.Provider delayDuration={250}>
        <AppShell />
      </Tooltip.Provider>
    </ErrorBoundary>
  );
}
