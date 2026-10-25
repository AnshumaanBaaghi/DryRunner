/** Expandable value preview (arrays, objects, Maps, Sets) read from a snapshot. */
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { orderedEntries, orderedProps } from '../../engine/timeline/heap';
import type { Snapshot, Timeline } from '../../engine/timeline/types';
import { deref, previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';

const MAX_CHILDREN = 200;

function children(tl: Timeline, snap: Snapshot, v: V): [string, V][] {
  const obj = deref(snap, v);
  if (!obj) return [];
  if (obj.elems) return obj.elems.toArray().slice(0, MAX_CHILDREN).map((e, i) => [String(i), e]);
  if (obj.kind === 'map') return orderedEntries(obj).slice(0, MAX_CHILDREN).map((e) => [previewValue(tl, snap, e.k, { depth: 0 }), e.v]);
  if (obj.kind === 'set') return orderedEntries(obj).slice(0, MAX_CHILDREN).map((e, i) => [String(i), e.v]);
  return orderedProps(obj).slice(0, MAX_CHILDREN).map(([k, slot]) => [k, slot.v]);
}

export function ValueTree({ tl, snap, value, depth = 0, highlight }: {
  tl: Timeline;
  snap: Snapshot;
  value: V;
  depth?: number;
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(deref(snap, value)) && depth < 6;
  const text = previewValue(tl, snap, value, { depth: 2, maxItems: 8, maxString: 40 });
  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        className={clsx('flex max-w-full items-start gap-0.5 text-left font-mono text-[12.5px]', expandable ? 'cursor-pointer' : 'cursor-default')}
      >
        {expandable && <ChevronRight size={13} className={clsx('mt-[3px] shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />}
        <span className={clsx('break-all', highlight ? 'text-hl-changed' : 'text-ink')}>{text}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-line pl-2">
          {children(tl, snap, value).map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <span className="shrink-0 font-mono text-[12px] text-ink-faint">{k}:</span>
              <ValueTree tl={tl} snap={snap} value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
