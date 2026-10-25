/** Variables of one frame with change highlights (old → new, "new", assigned) and fade-out on scope exit. */
import clsx from 'clsx';
import { changesForValue } from '../../engine/describe/changes';
import { visibleVars, type VisibleVar } from '../../engine/timeline/scope';
import type { FrameSnap } from '../../engine/timeline/types';
import { previewValue } from '../../engine/timeline/values';
import type { StepView } from '../../state/selectors';
import { ValueTree } from './ValueTree';

function Row({ view, frame, v }: { view: StepView; frame: FrameSnap; v: VisibleVar }) {
  const { tl, snap, diff } = view;
  const change = diff.vars.findLast((c) => c.bid === v.bid && c.callId === frame.callId);
  const nested = changesForValue(tl, snap, diff, v.slot.v);
  const fmt = (x: Parameters<typeof previewValue>[2]) => previewValue(tl, snap, x, { depth: 1, maxItems: 4, maxString: 18 });
  const changed = Boolean(change) || nested.length > 0;
  return (
    <div
      className={clsx('rounded-md px-2 py-1', changed && 'as-flash')}
      data-testid={`var-${v.name}`}
      data-changed={changed ? 'true' : 'false'}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-mono text-[12.5px] font-semibold text-hl-visited">{v.name}</span>
        <div className="min-w-0 flex-1">
          <ValueTree tl={tl} snap={snap} value={v.slot.v} highlight={changed} />
        </div>
        {change?.kind === 'new' && <span className="shrink-0 rounded bg-hl-done/15 px-1.5 text-[10px] font-semibold uppercase text-hl-done">new</span>}
        {change?.kind === 'same' && <span className="shrink-0 rounded bg-raised px-1.5 text-[10px] text-ink-faint">assigned</span>}
      </div>
      {change?.kind === 'changed' && change.old !== undefined && (
        <div className="mt-0.5 pl-1 font-mono text-[11.5px] text-ink-dim" data-testid={`var-${v.name}-delta`}>
          <span className="line-through decoration-hl-error/60">{fmt(change.old)}</span>
          <span className="px-1 text-ink-faint">→</span>
          <span className="text-hl-changed">{fmt(change.value)}</span>
        </div>
      )}
      {nested.map((n, k) => (
        <div key={k} className="mt-0.5 pl-1 font-mono text-[11.5px] text-hl-changed">
          {v.name}{n.prefix}{n.text.startsWith('[') || n.text.startsWith('.') ? '' : '.'}{n.text}
        </div>
      ))}
    </div>
  );
}

export function FrameVars({ view, frame, prevVisible }: { view: StepView; frame: FrameSnap; prevVisible?: VisibleVar[] }) {
  const vars = visibleVars(view.tl, frame);
  const gone = (prevVisible ?? []).filter((p) => !vars.some((v) => v.bid === p.bid));
  if (vars.length === 0 && gone.length === 0) return <div className="px-2 py-1 text-xs text-ink-faint">No variables yet.</div>;
  return (
    <div className="space-y-0.5">
      {vars.map((v) => {
        // remount changed rows each step so the flash animation replays
        const changed = view.diff.vars.some((c) => c.bid === v.bid && c.callId === frame.callId) ||
          changesForValue(view.tl, view.snap, view.diff, v.slot.v, 1).length > 0;
        return <Row key={changed ? `${v.bid}:${view.i}` : `${v.bid}`} view={view} frame={frame} v={v} />;
      })}
      {gone.map((v) => (
        <div key={`gone-${v.bid}-${view.i}`} className="as-fade-out flex items-center gap-2 px-2 py-1" title="out of scope">
          <span className="font-mono text-[12.5px] text-ink-faint line-through">{v.name}</span>
          <span className="text-[10px] uppercase text-ink-faint">out of scope</span>
        </div>
      ))}
    </div>
  );
}
