import { Tooltip } from 'radix-ui';
import { useEffect } from 'react';
import { sandbox } from './engine/sandbox/instance';
import { useRun } from './state/runStore';
import { AppShell } from './ui/AppShell';

export function App() {
  useEffect(() => {
    sandbox().warmUp();
    // show something immediately: dry-run whatever is in the editor (never pops dialogs)
    void useRun.getState().visualize({ auto: true });
  }, []);
  return (
    <Tooltip.Provider delayDuration={250}>
      <AppShell />
    </Tooltip.Provider>
  );
}
