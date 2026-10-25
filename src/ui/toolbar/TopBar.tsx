import clsx from 'clsx';
import { BookOpen, ChevronDown, CircleHelp, Loader2, Play, Settings, Square } from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { CATEGORIES, EXAMPLES, exampleById } from '../../examples';
import { useEditor } from '../../state/editorStore';
import { useRun } from '../../state/runStore';
import { useUi } from '../../state/uiStore';
import { Button, IconButton, Kbd } from '../primitives';
import { ViewMenu } from './ViewMenu';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['→', 'Step'],
  ['←', 'Step back'],
  ['⇧ →', 'Step over'],
  ['↓', 'Step into'],
  ['↑', 'Step out'],
  ['N', 'Next iteration'],
  ['⌘/Ctrl ↵', 'Visualize'],
  ['F9', 'Toggle breakpoint (editor)'],
];

function ExamplesMenu() {
  const exampleId = useEditor((s) => s.exampleId);
  const loadExample = useEditor((s) => s.loadExample);
  const visualize = useRun((s) => s.visualize);
  const current = exampleId ? exampleById(exampleId) : undefined;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button data-testid="examples-trigger" className="max-w-[min(16rem,32vw)] sm:max-w-[min(16rem,40vw)]">
          <BookOpen size={14} />
          <span className="truncate">{current ? current.title : 'Examples'}</span>
          <ChevronDown size={14} className="text-ink-faint" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="start" onCloseAutoFocus={(e) => e.preventDefault()}
          className="as-scroll z-50 max-h-[70vh] w-72 overflow-auto rounded-lg border border-line-strong bg-raised p-1 shadow-2xl">
          {CATEGORIES.map((cat) => (
            <DropdownMenu.Group key={cat}>
              <DropdownMenu.Label className="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{cat}</DropdownMenu.Label>
              {EXAMPLES.filter((e) => e.category === cat).map((e) => (
                <DropdownMenu.Item
                  key={e.id}
                  data-testid={`example-${e.id}`}
                  onSelect={() => {
                    loadExample(e.id);
                    void visualize();
                  }}
                  className={clsx('cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-highlighted:bg-panel-2',
                    e.id === exampleId ? 'text-hl-current' : 'text-ink')}
                >
                  {e.title}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function TopBar() {
  const status = useRun((s) => s.status);
  const visualize = useRun((s) => s.visualize);
  const cancel = useRun((s) => s.cancel);
  const ranSource = useRun((s) => s.ranSource);
  const code = useEditor((s) => s.code);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const busy = status === 'compiling' || status === 'running';
  const stale = ranSource !== null && ranSource !== code;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-3">
      <div className="mr-1 flex shrink-0 items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-[13px] font-black text-black">A</div>
        <div className="hidden leading-tight sm:block">
          <div className="text-sm font-semibold">AlgoScope <span className="text-hl-current">3D</span></div>
          <div className="text-[10px] text-ink-faint">dry-run any JavaScript</div>
        </div>
      </div>
      <ExamplesMenu />
      <Button variant="primary" onClick={() => void visualize()} disabled={status === 'compiling'} data-testid="visualize">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        <span className="hidden sm:inline">{stale ? 'Re-run' : 'Visualize'}</span>
        <span className="sm:hidden">Run</span>
      </Button>
      {status === 'running' && (
        <IconButton label="Stop" onClick={cancel}><Square size={14} /></IconButton>
      )}
      <ViewMenu />
      {stale && <span className="hidden text-xs text-hl-changed lg:inline" data-testid="stale">Code changed — re-run to update the trace</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Popover.Root>
          <Popover.Trigger asChild>
            <IconButton label="Keyboard shortcuts"><CircleHelp size={16} /></IconButton>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content sideOffset={6} align="end" onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 w-64 rounded-lg border border-line-strong bg-raised p-3 shadow-2xl">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Shortcuts</div>
              <div className="space-y-1.5">
                {SHORTCUTS.map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between text-sm"><span className="text-ink-dim">{label}</span><Kbd>{k}</Kbd></div>
                ))}
              </div>
              <div className="mt-3 text-[11px] text-ink-faint">Click the editor gutter to add a breakpoint; shift-click to add a condition.</div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)} data-testid="settings"><Settings size={16} /></IconButton>
      </div>
    </header>
  );
}
