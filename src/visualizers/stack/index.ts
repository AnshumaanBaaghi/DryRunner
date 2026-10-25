/** Stack visualizer: detection, HUD lines and the (lazily loaded) 3D view. */
import { lazy } from 'react';
import type { Timeline } from '../../engine/timeline/types';
import { previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import type { Detection, Visualizer } from '../types';
import { detectStacks, type StackBindings } from './detect';
import { stackObjAt } from './model';
import { evictionAt, fmtRank, indexedAt, isRank, rankOf } from './monotonic';
import { peekAt, stackOps } from './ops';

const StackView = lazy(() => import('./StackView').then((m) => ({ default: m.StackView })));

/** elements listed in one push line at most */
const MAX_LISTED = 4;

/** HUD lines: the element peeked, popped (on a monotonic stack: what made it go) or pushed at this step. */
function describe(tl: Timeline, i: number, d: Detection<StackBindings>): string[] {
  if (i === 0) return [];
  const b = d.bindings;
  const values = b.monotonic?.values;
  const text = (v: V) => previewValue(tl, tl.snapshots[i], v, { depth: 1, maxItems: 4, maxString: 12 });
  // over an indexed array the element shows its value: `3 (nums[3] = 4)`
  const named = (v: V) => {
    const rank = values ? rankOf(tl, v, indexedAt(tl, values, i)) : null;
    return values && isRank(rank) ? `${text(v)} (${values.name}[${text(v)}] = ${fmtRank(rank)})` : text(v);
  };
  const out: string[] = [];
  // the variable may take a new array at this step (a new call's stack)
  for (const id of new Set([stackObjAt(tl, b, i - 1), stackObjAt(tl, b, i)])) {
    if (id === null) continue;
    const peek = peekAt(tl, id, i);
    if (peek) out.push(`peek → ${named(peek.value)}`);
    const ops = stackOps(tl, id).filter((op) => op.step === i);
    for (const op of ops) {
      if (op.op !== 'pop') continue;
      const ev = b.monotonic && evictionAt(tl, id, i, op.index, b.monotonic);
      out.push(ev ? `pop ${text(op.value)} (${fmtRank(ev.popped)} ${ev.relation} ${fmtRank(ev.incoming)})` : `pop → ${named(op.value)}`);
    }
    const pushed = ops.filter((op) => op.op === 'push');
    if (pushed.length === 1) out.push(`push ${named(pushed[0].value)}`);
    else if (pushed.length) {
      out.push(`push ${pushed.slice(0, MAX_LISTED).map((op) => text(op.value)).join(', ')}${pushed.length > MAX_LISTED ? ', …' : ''}`);
    }
  }
  return out;
}

export const stackVisualizer: Visualizer<StackBindings> = {
  id: 'stack',
  label: 'Stack',
  detect: detectStacks,
  Component: StackView,
  describe,
  cameraTilt: 0.3,
};
