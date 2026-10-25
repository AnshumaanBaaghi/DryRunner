/**
 * Pure per-step model of the hash-map view (testable without WebGL): one card per entry in insertion
 * order (the newest CARD_CAP, keeping this step's entries in view), what each card does this step —
 * drops in (added), pulses with old → new (updated), flashes amber (found by a lookup) — the entries
 * leaving, the keys a lookup missed, the size and the card to focus. Stepping back plays the undone
 * step backwards: an added entry lifts out, a removed one drops back in, an update shows new → old.
 */
import type { Timeline } from '../../engine/timeline/types';
import type { ObjId } from '../../engine/types/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import type { HashKind, HashMapBindings } from './detect';
import {
  bindingKey, cardText, entriesOf, eventsAt, followedIds, keyText, missText, shownId, sizeOf, valueText, type Entry,
} from './entries';

/** most cards the grid shows (the newest entries) */
export const CARD_CAP = 24;
/** resting entry: a muted blue */
export const ENTRY_COLOR = '#22436a';

export type CardState = 'idle' | 'added' | 'updated' | 'hit';

export interface CardModel {
  id: string;
  text: string;
  state: CardState;
  color: string;
  pulse: boolean;
  /** drops into place: added (stepping back: a removal undone) */
  entered: boolean;
  /** `old → new` of an updated value (stepping back: new → old) */
  delta?: string;
}

export interface LeavingModel {
  id: string;
  /** the slot it had in the grid it leaves */
  slot: number;
  text: string;
  color: string;
}

export interface HashModel {
  kind: HashKind;
  /** the object exists at this step */
  exists: boolean;
  size: number;
  /** shown entries in insertion order */
  cards: CardModel[];
  /** older entries left out */
  hidden: number;
  /** removed (stepping back: an addition undone), rising out of their old slots */
  leaving: LeavingModel[];
  /** keys this step looked up without finding them */
  misses: string[];
  /** slot of the card changed or read this step */
  focus: number | null;
}

const COLOR: Record<CardState, string> = { idle: ENTRY_COLOR, added: COLORS.changed, updated: COLORS.changed, hit: COLORS.current };

/** The newest CARD_CAP entries; older ones this step touches take the first slots. */
export function windowOf(entries: Entry[], keep: ReadonlySet<string>): Entry[] {
  if (entries.length <= CARD_CAP) return entries;
  const start = entries.length - CARD_CAP;
  const older = entries.slice(0, start).filter((e) => keep.has(e.id)).slice(0, CARD_CAP);
  return [...older, ...entries.slice(start + older.length)];
}

interface Mark {
  state: Exclude<CardState, 'idle'>;
  entered: boolean;
  delta?: string;
}

export function buildHashModel(tl: Timeline, i: number, b: HashMapBindings, hl: Highlight | null): HashModel {
  const id = shownId(tl, b, i);
  const snap = tl.snapshots[i];
  const obj = snap.heap.get(id);
  const entries = entriesOf(obj, b.kind);
  // forward: this step's changes and lookups; backward: the undone step's changes, played in reverse
  const reversed = hl?.reversed ?? false;
  const at = reversed ? i + 1 : i;
  const ev = hl && tl.snapshots[at] ? eventsAt(tl, at, id, b.kind) : null;
  const marks = new Map<string, Mark>();
  const gone: Entry[] = [];
  for (const c of ev?.changes ?? []) {
    if (c.kind === 'updated') {
      const old = valueText(tl, tl.snapshots[at - 1], c.before.value);
      const now = valueText(tl, tl.snapshots[at], c.after.value);
      const delta = b.kind === 'set' ? undefined : reversed ? `${now} → ${old}` : `${old} → ${now}`;
      marks.set(c.id, { state: 'updated', entered: false, ...(delta && { delta }) });
    } else if ((c.kind === 'added') !== reversed) marks.set(c.id, { state: 'added', entered: true });
    else gone.push(c.kind === 'added' ? c.after : c.before);
  }
  const lookups = reversed ? [] : ev?.lookups ?? [];
  for (const l of lookups) if (l.found && !marks.has(l.id)) marks.set(l.id, { state: 'hit', entered: false });
  const shown = windowOf(entries, new Set(marks.keys()));
  const cards = shown.map((e): CardModel => {
    const m = marks.get(e.id);
    const state = m?.state ?? 'idle';
    return {
      id: e.id, text: cardText(tl, snap, b.kind, e), state, color: COLOR[state], pulse: Boolean(m), entered: m?.entered ?? false,
      ...(m?.delta && { delta: m.delta }),
    };
  });
  // leaving entries are drawn as they were, in the grid they leave
  const other = tl.snapshots[reversed ? i + 1 : i - 1];
  const otherShown = gone.length && other ? windowOf(entriesOf(other.heap.get(id), b.kind), new Set(gone.map((e) => e.id))) : [];
  const leaving = gone.map((e): LeavingModel => ({
    id: e.id, slot: otherShown.findIndex((x) => x.id === e.id), text: other ? cardText(tl, other, b.kind, e) : '',
    color: reversed ? COLORS.changed : COLORS.error,
  })).filter((l) => l.slot >= 0);
  const slotOf = (states: CardState[]) => {
    const k = cards.findIndex((c) => states.includes(c.state));
    return k >= 0 ? k : null;
  };
  return {
    kind: b.kind, exists: Boolean(obj), size: entries.length, cards, hidden: entries.length - shown.length, leaving,
    misses: lookups.filter((l) => !l.found).map((l) => keyText(tl, snap, l.key)),
    focus: slotOf(['added', 'updated']) ?? leaving[0]?.slot ?? slotOf(['hit']),
  };
}

export interface HashExtent {
  /** most entries the shown objects hold at once */
  maxEntries: number;
  /** longest card text (characters) */
  widest: number;
  /** longest miss chip text (characters; 0: no lookup misses) */
  widestMiss: number;
}

const extentCache = new WeakMap<Timeline, Map<string, { steps: number; extent: HashExtent }>>();

const textLength = (s: string) => [...s].length;

/** Trace-wide sizes, so the panel never jumps: sizes and texts change only where an entry is written or looked up. */
export function hashExtent(tl: Timeline, b: HashMapBindings): HashExtent {
  const key = bindingKey(b);
  let byKey = extentCache.get(tl);
  if (!byKey) extentCache.set(tl, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit && hit.steps === tl.steps.length) return hit.extent;
  const ids = followedIds(tl, b);
  const extent: HashExtent = { maxEntries: 0, widest: 0, widestMiss: 0 };
  tl.diffs.forEach((d, s) => {
    const snap = tl.snapshots[s];
    const touched = new Set<ObjId>();
    for (const h of d.heap) if (ids.has(h.id)) touched.add(h.id);
    for (const r of d.reads) if (ids.has(r.id)) touched.add(r.id);
    for (const id of touched) {
      const ev = eventsAt(tl, s, id, b.kind);
      extent.maxEntries = Math.max(extent.maxEntries, sizeOf(snap.heap.get(id), b.kind));
      for (const c of ev.changes) if (c.kind !== 'removed') extent.widest = Math.max(extent.widest, textLength(cardText(tl, snap, b.kind, c.after)));
      const missed = ev.lookups.filter((l) => !l.found).map((l) => keyText(tl, snap, l.key));
      if (missed.length) extent.widestMiss = Math.max(extent.widestMiss, textLength(missText(missed)));
    }
  });
  // values that are references read differently once their objects changed
  const last = tl.snapshots[tl.snapshots.length - 1];
  for (const id of ids) for (const e of entriesOf(last.heap.get(id), b.kind)) extent.widest = Math.max(extent.widest, textLength(cardText(tl, last, b.kind, e)));
  byKey.set(key, { steps: tl.steps.length, extent });
  return extent;
}
