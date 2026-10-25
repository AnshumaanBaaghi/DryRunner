/** Virtualized dry-run trace table: click a row to jump there; changed cells highlighted; export. */
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { Columns3, Copy, Download } from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { useEffect, useMemo, useRef } from 'react';
import { toCSV, toMarkdown, traceColumns, traceRow, type TraceRowData } from '../../engine/describe/traceRows';
import type { Timeline } from '../../engine/timeline/types';
import { usePlayback } from '../../state/playbackStore';
import { useStepView } from '../../state/selectors';
import { useUi } from '../../state/uiStore';
import { IconButton, PanelHeader } from '../primitives';

const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 28;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cellClass = (state: string) => clsx(
  'truncate px-2 font-mono text-[12px]',
  state === 'changed' && 'bg-hl-changed/15 font-semibold text-hl-changed',
  state === 'new' && 'bg-hl-done/12 font-semibold text-hl-done',
  state === 'heap' && 'bg-hl-changed/10 text-hl-changed',
  state === 'same' && 'bg-raised text-ink',
  (state === 'none' || state === 'empty') && 'text-ink-dim',
);

export function TraceTable() {
  const view = useStepView();
  const goto = usePlayback((s) => s.goto);
  const hidden = useUi((s) => s.hiddenColumns);
  const toggleColumn = useUi((s) => s.toggleColumn);
  const tl = view?.tl ?? null;
  const columns = useMemo(() => (tl ? traceColumns(tl) : []), [tl, view?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = columns.filter((c) => !hidden.includes(c.key));
  const cache = useRef<{ tl: Timeline | null; key: string; rows: Map<number, TraceRowData> }>({ tl: null, key: '', rows: new Map() });
  const colKey = columns.map((c) => c.key).join('|');
  if (cache.current.tl !== tl || cache.current.key !== colKey) cache.current = { tl, key: colKey, rows: new Map() };
  const rowAt = (i: number): TraceRowData => {
    let r = cache.current.rows.get(i);
    if (!r && tl) {
      r = traceRow(tl, i, columns);
      cache.current.rows.set(i, r);
    }
    return r as TraceRowData;
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const count = tl?.steps.length ?? 0;
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12,
    // rows start below the sticky header, and scrolled-to rows must not hide under it
    scrollMargin: HEADER_HEIGHT, scrollPaddingStart: HEADER_HEIGHT,
  });
  const current = view?.i ?? 0;
  useEffect(() => {
    if (count) virtualizer.scrollToIndex(current, { align: 'auto' });
  }, [current, count, virtualizer]);

  const template = `56px 44px minmax(110px, 150px) 84px minmax(240px, 2fr) ${shown.map(() => 'minmax(84px, 1fr)').join(' ')} minmax(110px, 1fr)`;
  const minWidth = 56 + 44 + 110 + 84 + 240 + shown.length * 84 + 110;
  const allRows = () => (tl ? tl.steps.map((_, i) => rowAt(i)) : []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="trace-table">
      <PanelHeader title={`Dry-run trace${count ? ` · ${count - 1} steps` : ''}`}>
        <Popover.Root>
          <Popover.Trigger asChild>
            <IconButton label="Choose columns" disabled={!columns.length}><Columns3 size={14} /></IconButton>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content sideOffset={6} onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 max-h-72 w-52 overflow-auto rounded-lg border border-line-strong bg-raised p-2 shadow-xl">
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-ink-faint">Variables</div>
              {columns.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-panel-2">
                  <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} className="accent-amber-500" />
                  <span className="font-mono text-xs">{c.label}</span>
                </label>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="Export" disabled={!count} data-testid="export"><Download size={14} /></IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content sideOffset={6} onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 min-w-44 rounded-lg border border-line-strong bg-raised p-1 text-sm shadow-xl">
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-highlighted:bg-panel-2"
                onSelect={() => void copyText(toMarkdown(shown, allRows()))}>
                <Copy size={13} /> Copy as Markdown
              </DropdownMenu.Item>
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-highlighted:bg-panel-2"
                onSelect={() => void copyText(toCSV(shown, allRows()))}>
                <Copy size={13} /> Copy as CSV
              </DropdownMenu.Item>
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-highlighted:bg-panel-2"
                onSelect={() => download('algoscope-trace.csv', toCSV(shown, allRows()), 'text/csv')}>
                <Download size={13} /> Download CSV
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </PanelHeader>
      {!tl ? (
        <div className="p-3 text-xs text-ink-faint">The trace table fills in once you visualize a program.</div>
      ) : (
        <div ref={scrollRef} className="as-scroll min-h-0 flex-1 overflow-auto">
          <div style={{ minWidth }}>
            <div className="sticky top-0 z-10 grid items-center border-b border-line bg-panel-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
              style={{ gridTemplateColumns: template, height: HEADER_HEIGHT }}>
              <span className="px-2">Step</span><span className="px-2">Line</span><span className="px-2">Frame</span>
              <span className="px-2">Loops</span><span className="px-2">Event</span>
              {shown.map((c) => <span key={c.key} className="truncate px-2 normal-case font-mono">{c.label}</span>)}
              <span className="px-2">Output</span>
            </div>
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const r = rowAt(item.index);
                const isCurrent = item.index === current;
                return (
                  <button
                    type="button"
                    key={item.key}
                    data-testid={`trace-row-${item.index}`}
                    data-current={isCurrent}
                    onClick={() => goto(item.index, 'jump')}
                    className={clsx('absolute left-0 grid w-full items-center border-b border-line/60 text-left hover:bg-raised',
                      isCurrent && 'bg-hl-current/10 outline outline-1 -outline-offset-1 outline-hl-current/60',
                      r.kind === 'error' && 'bg-hl-error/10')}
                    style={{ height: ROW_HEIGHT, transform: `translateY(${item.start - HEADER_HEIGHT}px)`, gridTemplateColumns: template }}
                  >
                    <span className="px-2 font-mono text-[11px] text-ink-faint tabular-nums">{r.step}</span>
                    <span className="px-2 font-mono text-[11px] text-ink-dim tabular-nums">{r.line || ''}</span>
                    <span className="truncate px-2 font-mono text-[11.5px] text-hl-visited">{r.frame}</span>
                    <span className="truncate px-2 font-mono text-[11px] text-hl-window">{r.loops}</span>
                    <span className="truncate px-2 font-mono text-[11.5px] text-ink" title={r.event}>{r.event}</span>
                    {shown.map((c) => {
                      const cell = r.cells[c.key];
                      return (
                        <span key={c.key} className={cellClass(cell?.state ?? 'empty')} data-state={cell?.state ?? 'empty'}
                          title={cell?.old !== undefined ? `${cell.old} → ${cell.text}` : cell?.full ?? cell?.text}>
                          {cell?.text}
                        </span>
                      );
                    })}
                    <span className="truncate px-2 font-mono text-[11.5px] text-hl-done">{r.output}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
