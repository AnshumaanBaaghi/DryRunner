/** Desktop: resizable editor | stage | variables over a trace table. Mobile: stacked with tabs + bottom sheet. */
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useMediaQuery } from '../state/selectors';
import { useUi, type MobileTab } from '../state/uiStore';
import { ConsolePanel } from './console/ConsolePanel';
import { Dialogs } from './dialogs/Dialogs';
import { LazyCodeEditor } from './editor/LazyCodeEditor';
import { PlaybackBar } from './playback/PlaybackBar';
import { StageArea } from './stage/StageArea';
import { TopBar } from './toolbar/TopBar';
import { TraceTable } from './traceTable/TraceTable';
import { useShortcuts } from './useShortcuts';
import { VariablesPanel } from './variables/VariablesPanel';

function Handle({ vertical = false }: { vertical?: boolean }) {
  return (
    <Separator
      className={clsx('group relative shrink-0 bg-line transition-colors hover:bg-hl-current/60 data-[separator=active]:bg-hl-current',
        vertical ? 'h-px w-full' : 'h-full w-px')}
    >
      <span className={clsx('absolute', vertical ? '-inset-y-1.5 inset-x-0' : '-inset-x-1.5 inset-y-0')} />
    </Separator>
  );
}

function DesktopLayout() {
  const tableOpen = useUi((s) => s.tableOpen);
  return (
    <Group orientation="vertical" className="min-h-0 flex-1">
      <Panel defaultSize="66" minSize="30">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize="36" minSize="18">
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize="72" minSize="25"><LazyCodeEditor /></Panel>
              <Handle vertical />
              <Panel defaultSize="28" minSize="10"><ConsolePanel /></Panel>
            </Group>
          </Panel>
          <Handle />
          <Panel defaultSize="44" minSize="20"><StageArea /></Panel>
          <Handle />
          <Panel defaultSize="20" minSize="14"><VariablesPanel /></Panel>
        </Group>
      </Panel>
      {tableOpen && (
        <>
          <Handle vertical />
          <Panel defaultSize="34" minSize="12"><TraceTable /></Panel>
        </>
      )}
    </Group>
  );
}

function MobileLayout() {
  const tab = useUi((s) => s.mobileTab);
  const setTab = useUi((s) => s.setMobileTab);
  const tableOpen = useUi((s) => s.sheetOpen);
  const setTableOpen = useUi((s) => s.setSheetOpen);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="h-[38vh] shrink-0 border-b border-line"><StageArea /></div>
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as MobileTab)} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 border-b border-line bg-panel">
          {(['code', 'vars', 'console'] as const).map((t) => (
            <Tabs.Trigger key={t} value={t}
              className="flex-1 py-2 text-xs font-medium uppercase tracking-wide text-ink-faint data-[state=active]:border-b-2 data-[state=active]:border-hl-current data-[state=active]:text-ink">
              {t === 'vars' ? 'Variables' : t}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="code" className="min-h-0 flex-1"><LazyCodeEditor /></Tabs.Content>
        <Tabs.Content value="vars" className="min-h-0 flex-1"><VariablesPanel /></Tabs.Content>
        <Tabs.Content value="console" className="min-h-0 flex-1"><ConsolePanel /></Tabs.Content>
      </Tabs.Root>
      <div className={clsx('absolute inset-x-0 bottom-0 z-30 h-[75%] translate-y-0 overflow-hidden rounded-t-xl border-t border-line-strong bg-panel shadow-2xl transition-transform duration-300',
        !tableOpen && 'pointer-events-none translate-y-[110%]')}
        aria-hidden={!tableOpen}>
        <div className="relative flex h-6 items-center justify-center">
          <div className="h-1 w-10 rounded-full bg-line-strong" />
          <button type="button" aria-label="Close trace table" onClick={() => setTableOpen(false)}
            className="absolute right-2 top-0.5 rounded p-0.5 text-ink-faint hover:text-ink"><X size={15} /></button>
        </div>
        <div className="h-[calc(100%-24px)]"><TraceTable /></div>
      </div>
    </div>
  );
}

export function AppShell() {
  useShortcuts();
  const mobile = useMediaQuery('(max-width: 899px)');
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      {mobile ? <MobileLayout /> : <DesktopLayout />}
      <PlaybackBar />
      <Dialogs />
    </div>
  );
}
