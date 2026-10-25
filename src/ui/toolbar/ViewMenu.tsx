/**
 * "View" menu: what the 3D stage shows. Automatic by default; the user can pick the main view, show or
 * hide views (with the detector's confidence), show any variable with a chosen view (role mapping) and
 * choose which variables the variables view lists. Choices last while the same code is re-run.
 */
import clsx from 'clsx';
import { Check, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useMemo, type ReactNode } from 'react';
import { varKey, type VarRef } from '../../engine/detect/track';
import { useViz } from '../../state/vizStore';
import { visualizerById, visualizers } from '../../visualizers/registry';
import type { Detection } from '../../visualizers/types';
import { Button } from '../primitives';

const ITEM = 'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm text-ink outline-none data-highlighted:bg-panel-2 data-disabled:opacity-40';
const LABEL = 'px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint';
const CONTENT = 'as-scroll z-50 max-h-[70vh] min-w-56 overflow-auto rounded-lg border border-line-strong bg-raised p-1 shadow-2xl';
const MAX_LISTED = 10;

const viewName = (d: Detection) => `${visualizerById(d.vizId)?.label ?? d.vizId} · ${d.title}`;
const confidence = (d: Detection) => (d.key.startsWith('bound:') ? 'yours' : `${Math.round(Math.min(1, d.score) * 100)}%`);

function Row({ name, detail, children }: { name: string; detail?: string; children?: ReactNode }) {
  return (
    <>
      <span className="grid w-4 place-items-center">{children}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {detail && <span className="shrink-0 text-[11px] text-ink-faint">{detail}</span>}
    </>
  );
}

function Sub({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={ITEM} data-testid={testId}>
        <Row name={label}><ChevronRight size={13} className="text-ink-faint" /></Row>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className={CONTENT}>{children}</DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export function ViewMenu() {
  const timeline = useViz((s) => s.timeline);
  const analysis = useViz((s) => s.analysis);
  const candidates = useViz((s) => s.candidates);
  const bound = useViz((s) => s.bound);
  const active = useViz((s) => s.active);
  const overrides = useViz((s) => s.overrides);
  const hiddenVars = useViz((s) => s.hiddenVars);
  const { setPrimary, setShown, bindVariable, resetOverrides, toggleVar } = useViz.getState();
  const custom = overrides.primary !== null || overrides.hidden.length + overrides.shown.length + overrides.binds.length + hiddenVars.length > 0;
  const shownKeys = new Set(active.map((d) => d.key));
  const primary = active.find((d) => d.role === 'primary');
  const listed = useMemo(() => {
    const shown = new Set(active.map((d) => d.key));
    const all = [...bound, ...candidates.filter((c) => !bound.some((b) => b.key === c.key))];
    return [...all.filter((d) => shown.has(d.key)), ...all.filter((d) => !shown.has(d.key))].slice(0, MAX_LISTED);
  }, [bound, candidates, active]);
  const bindable = useMemo(() => {
    if (!timeline || !analysis) return [];
    const ctx = { tl: timeline, analysis };
    const plugins = visualizers().filter((p) => p.bindTo);
    const out: { ref: VarRef; views: { vizId: string; label: string }[] }[] = [];
    for (const info of analysis.vars.values()) {
      if (info.kinds.has('fn') || !(info.kinds.has('ref') || info.kinds.has('string'))) continue;
      const views = plugins.filter((p) => {
        try {
          return p.bindTo!(ctx, info.ref) !== null;
        } catch {
          return false;
        }
      }).map((p) => ({ vizId: p.id, label: p.label }));
      if (views.length) out.push({ ref: info.ref, views });
    }
    return out.slice(0, 24);
  }, [timeline, analysis]);
  const scalarNames = useMemo(() => {
    if (!analysis) return [];
    const names = [...analysis.vars.values()].filter((v) => !v.kinds.has('fn') && !v.kinds.has('ref')).map((v) => v.ref.name);
    return [...new Set(names)].slice(0, 40);
  }, [analysis]);
  const fnName = (ref: VarRef) => (ref.fnId === 0 ? '' : ` (${timeline?.meta.fns[ref.fnId]?.name ?? 'fn'})`);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button data-testid="view-trigger" disabled={!timeline} aria-label="View" className="px-2 sm:px-3">
          <Layers size={14} className={custom ? 'text-hl-current' : undefined} />
          <span className="hidden sm:inline">View: {custom ? 'custom' : 'auto'}</span>
          <ChevronDown size={14} className="hidden text-ink-faint sm:block" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="start" onCloseAutoFocus={(e) => e.preventDefault()} className={clsx(CONTENT, 'w-80')}>
          <DropdownMenu.Item className={ITEM} data-testid="view-auto" onSelect={() => resetOverrides()}>
            <Row name="Automatic" detail="detected from the trace">{!custom && <Check size={13} className="text-hl-current" />}</Row>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className={LABEL}>Main view</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={primary?.key ?? ''} onValueChange={(key) => setPrimary(key)}>
            {listed.map((d) => (
              <DropdownMenu.RadioItem key={d.key} value={d.key} className={ITEM} data-testid={`view-primary-${d.vizId}`}>
                <Row name={viewName(d)} detail={confidence(d)}>
                  <DropdownMenu.ItemIndicator><span className="block h-2 w-2 rounded-full bg-hl-current" /></DropdownMenu.ItemIndicator>
                </Row>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>

          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className={LABEL}>Show</DropdownMenu.Label>
          {listed.map((d) => (
            <DropdownMenu.CheckboxItem key={d.key} checked={shownKeys.has(d.key)} className={ITEM} data-testid={`view-show-${d.vizId}`}
              onCheckedChange={(on) => setShown(d.key, on)} onSelect={(e) => e.preventDefault()}>
              <Row name={viewName(d)} detail={confidence(d)}>
                <DropdownMenu.ItemIndicator><Check size={13} className="text-hl-current" /></DropdownMenu.ItemIndicator>
              </Row>
            </DropdownMenu.CheckboxItem>
          ))}

          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <Sub label="Show a variable as…" testId="view-bind">
            {!bindable.length && <div className="px-2 py-1.5 text-sm text-ink-faint">No arrays, maps or sets in this run</div>}
            {bindable.map(({ ref, views }) => (
              <Sub key={varKey(ref)} label={`${ref.name}${fnName(ref)}`} testId={`view-bind-${ref.name}`}>
                {views.map((v) => (
                  <DropdownMenu.Item key={v.vizId} className={ITEM} data-testid={`view-bind-${ref.name}-${v.vizId}`}
                    onSelect={() => bindVariable(v.vizId, ref)}>
                    <Row name={v.label} />
                  </DropdownMenu.Item>
                ))}
              </Sub>
            ))}
          </Sub>
          <Sub label="Variables view lists…" testId="view-vars">
            {!scalarNames.length && <div className="px-2 py-1.5 text-sm text-ink-faint">No plain variables in this run</div>}
            {scalarNames.map((name) => (
              <DropdownMenu.CheckboxItem key={name} checked={!hiddenVars.includes(name)} className={ITEM} data-testid={`view-var-${name}`}
                onCheckedChange={() => toggleVar(name)} onSelect={(e) => e.preventDefault()}>
                <Row name={name}>
                  <DropdownMenu.ItemIndicator><Check size={13} className="text-hl-current" /></DropdownMenu.ItemIndicator>
                </Row>
              </DropdownMenu.CheckboxItem>
            ))}
          </Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
