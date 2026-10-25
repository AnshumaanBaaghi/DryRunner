/** Watch expressions evaluated against the recorded state at the current step. */
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { evaluateWatch } from '../../engine/watch/evaluate';
import type { StepView } from '../../state/selectors';
import { useWatches } from '../../state/watchStore';

export function WatchList({ view }: { view: StepView | null }) {
  const watches = useWatches((s) => s.watches);
  const { add, update, remove } = useWatches.getState();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="space-y-1" data-testid="watches">
      {watches.map((w) => {
        const r = view ? evaluateWatch(view.tl, view.i, w.expr) : null;
        return (
          <div key={w.id} className="group flex items-start gap-2 rounded-md px-2 py-1 hover:bg-raised">
            {editing === w.id ? (
              <input
                autoFocus
                defaultValue={w.expr}
                className="w-full rounded border border-line-strong bg-panel-2 px-1.5 py-0.5 font-mono text-[12px] text-ink outline-none"
                onBlur={(e) => {
                  update(w.id, e.target.value);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <button type="button" onClick={() => setEditing(w.id)} className="min-w-0 flex-1 text-left">
                <div className="font-mono text-[12px] text-hl-frontier">{w.expr}</div>
                <div className="break-all font-mono text-[12.5px]" data-testid="watch-value">
                  {!r ? <span className="text-ink-faint">—</span> : r.ok ? <span className="text-ink">{r.display}</span> : <span className="text-hl-error/80">{r.error}</span>}
                </div>
              </button>
            )}
            <button type="button" aria-label="Remove watch" onClick={() => remove(w.id)} className="mt-0.5 text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink">
              <X size={13} />
            </button>
          </div>
        );
      })}
      <form
        className="flex items-center gap-1 px-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
          setDraft('');
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add watch, e.g. right - left + 1"
          aria-label="New watch expression"
          className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
        <button type="submit" aria-label="Add watch" className="rounded p-1 text-ink-dim hover:bg-raised hover:text-ink">
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
