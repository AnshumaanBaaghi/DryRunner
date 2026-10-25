/**
 * Pure per-step model of the stack (testable without WebGL): the drawn items bottom → top with stable
 * identities, the items entering (pushed; stepping back: the undone pop's) and leaving (popped, drawn
 * from the neighbouring snapshot; stepping back: the undone push's), the peeked and top indexes, the cap.
 */
import { valueAt, varKey } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { previewValue, refId } from '../../engine/timeline/values';
import type { ObjId, V } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import { idsAt } from '../array/identity';
import type { StackBindings } from './detect';
import { evictionAt, fmtRank, indexedAt, isRank, rankOf, type Rank } from './monotonic';
import { peekAt } from './ops';

/** items drawn at most (the ones further down are counted, not drawn) */
export const MAX_ITEMS = 12;

export type ItemState = 'idle' | 'pushed' | 'peeked';
export type LeavingState = 'popped' | 'evicted' | 'undone';

export interface ItemModel {
  /** stable while the element stays on the stack */
  key: string;
  /** array index (0 = bottom) */
  index: number;
  /** position from the bottom of the drawn column */
  slot: number;
  /** the element; over an indexed array also the value it indexes: `3 · 4` (nums[3] = 4) */
  text: string;
  color: string;
  state: ItemState;
  /** entering at this step: pushed (stepping back: the element the undone pop took) */
  isNew: boolean;
}

export interface LeavingModel extends Omit<ItemModel, 'state' | 'isNew'> {
  /** popped (evicted: making room for a monotonic stack's next element); undone: a push stepped back over */
  state: LeavingState;
  /** evicted: the comparison that popped it (`2 < 4`) */
  reason?: string;
}

export interface StackModel {
  /** the variable holds an array */
  exists: boolean;
  /** bottom → top: the top element is last */
  items: ItemModel[];
  /** leaving at this step, drawn where they were one step away */
  leaving: LeavingModel[];
  /** elements below the drawn ones */
  hiddenBelow: number;
  /** array index of the top element (null when empty) */
  top: number | null;
  /** array index of the element peeked at this step */
  peek: number | null;
}

/** smallest → largest value of a monotonic stack */
const SHADE_LOW = [0x2b, 0x39, 0x54];
const SHADE_HIGH = [0x6d, 0x8f, 0xf0];

/** Item color of a monotonic stack's value at `t` (0 = smallest of the run, 1 = largest). */
export function shadeColor(t: number): string {
  return `#${SHADE_LOW.map((lo, k) => Math.round(lo + (SHADE_HIGH[k] - lo) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The array the stack variable holds at step i (a new call's stack takes the variable over). */
export function stackObjAt(tl: Timeline, b: StackBindings, i: number): ObjId | null {
  const id = refId(valueAt(tl, b.target, i));
  return id !== null && tl.snapshots[i]?.heap.get(id)?.kind === 'array' ? id : null;
}

interface RunScale {
  n: number;
  maxLen: number;
  /** monotonic: value → shade (0..1 by rank) */
  shades: Map<Rank, number>;
}

const scaleCache = new WeakMap<Timeline, Map<string, RunScale>>();

/** Stable across the run: the tallest stack and the shade of every value a monotonic stack holds. */
function runScale(tl: Timeline, b: StackBindings): RunScale {
  let byKey = scaleCache.get(tl);
  if (!byKey) {
    byKey = new Map();
    scaleCache.set(tl, byKey);
  }
  const key = `${varKey(b.target)}:${b.monotonic?.values ? varKey(b.monotonic.values) : ''}`;
  const hit = byKey.get(key);
  if (hit && hit.n === tl.steps.length) return hit;
  let maxLen = 0;
  const ranks = new Set<Rank>();
  let last: ObjId | null = null;
  for (let i = 0; i < tl.steps.length; i++) {
    const id = stackObjAt(tl, b, i);
    const elems = id === null ? undefined : tl.snapshots[i].heap.get(id)?.elems;
    maxLen = Math.max(maxLen, elems?.size ?? 0);
    const changed = id !== last || tl.diffs[i].heap.some((h) => h.id === id);
    last = id;
    if (!b.monotonic || !elems || !changed) continue;
    const indexed = indexedAt(tl, b.monotonic.values, i);
    for (const e of elems) {
      const r = rankOf(tl, e, indexed);
      if (isRank(r)) ranks.add(r);
    }
  }
  const sorted = [...ranks].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const shades = new Map(sorted.map((r, k): [Rank, number] => [r, sorted.length > 1 ? k / (sorted.length - 1) : 1]));
  const scale = { n: tl.steps.length, maxLen, shades };
  byKey.set(key, scale);
  return scale;
}

/** Rows to size the view for: the tallest stack of the run (capped). */
export function stackRows(tl: Timeline, b: StackBindings): number {
  return Math.min(MAX_ITEMS, Math.max(1, runScale(tl, b).maxLen));
}

const preview = (tl: Timeline, i: number, v: V | undefined) => previewValue(tl, tl.snapshots[i], v, { depth: 1, maxItems: 3, maxString: 8 });

type Drawn = Omit<ItemModel, 'state' | 'isNew'>;

interface Column {
  id: ObjId | null;
  /** identities of every element, drawn or not */
  keys: Set<string>;
  items: Drawn[];
  hiddenBelow: number;
}

function columnAt(tl: Timeline, b: StackBindings, i: number): Column {
  const id = stackObjAt(tl, b, i);
  const elems = id === null ? [] : tl.snapshots[i].heap.get(id)?.elems?.toArray() ?? [];
  const ids = id === null ? null : idsAt(tl, id, i);
  const keyOf = (index: number) => `${id}:${ids?.[index] ?? `ix${index}`}`;
  const hiddenBelow = Math.max(0, elems.length - MAX_ITEMS);
  const values = b.monotonic?.values;
  const indexed = indexedAt(tl, values, i);
  const shades = b.monotonic ? runScale(tl, b).shades : null;
  const items = elems.slice(hiddenBelow).map((e, slot): Drawn => {
    const rank = shades ? rankOf(tl, e, indexed) : null;
    const shade = isRank(rank) ? shades?.get(rank) : undefined;
    const own = preview(tl, i, e);
    return {
      key: keyOf(hiddenBelow + slot),
      index: hiddenBelow + slot,
      slot,
      text: values && isRank(rank) ? `${own} · ${fmtRank(rank)}` : own,
      color: shade === undefined ? COLORS.idle : shadeColor(shade),
    };
  });
  return { id, keys: new Set(elems.map((_, k) => keyOf(k))), items, hiddenBelow };
}

export function buildStackModel(tl: Timeline, i: number, b: StackBindings, hl: Highlight | null): StackModel {
  const cur = columnAt(tl, b, i);
  // the step one away: forward the previous one, stepping back the one undone
  const j = hl ? (hl.reversed ? i + 1 : i - 1) : -1;
  const near = j >= 0 && j < tl.steps.length ? columnAt(tl, b, j) : null;
  const peek = hl && cur.id !== null ? peekAt(tl, cur.id, hl.reversed ? i + 1 : i)?.index ?? null : null;
  const items = cur.items.map((it): ItemModel => {
    const isNew = near !== null && !near.keys.has(it.key);
    const state: ItemState = isNew ? 'pushed' : it.index === peek ? 'peeked' : 'idle';
    return { ...it, state, isNew, color: state === 'pushed' ? COLORS.changed : state === 'peeked' ? COLORS.current : it.color };
  });
  const leaving = (near?.items ?? []).filter((it) => !cur.keys.has(it.key)).map((it): LeavingModel => {
    if (hl?.reversed) return { ...it, state: 'undone', color: COLORS.changed };
    const ev = b.monotonic && near && near.id !== null ? evictionAt(tl, near.id, i, it.index, b.monotonic) : null;
    return ev
      ? { ...it, state: 'evicted', color: COLORS.error, reason: `${fmtRank(ev.popped)} ${ev.relation} ${fmtRank(ev.incoming)}` }
      : { ...it, state: 'popped', color: COLORS.current };
  });
  const top = items[items.length - 1];
  return { exists: cur.id !== null, items, leaving, hiddenBelow: cur.hiddenBelow, top: top ? top.index : null, peek };
}
