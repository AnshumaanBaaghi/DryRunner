/**
 * HUD lines of a step: the lookups it made (a hit with the value found, or a miss) and the entries it
 * added, updated or removed — `lookup 'a' → hit (3)`, `added 'c' → 2`, `visited.add(4)`, `removed 'b'`.
 * Creating the map is the narration's to tell.
 */
import type { Timeline } from '../../engine/timeline/types';
import type { Detection } from '../types';
import type { HashMapBindings } from './detect';
import { eventsAt, hudText, shownId, type Change } from './entries';

/** beyond this many lines the rest are counted */
const MAX_LINES = 4;

export function describeHashMap(tl: Timeline, i: number, d: Detection<HashMapBindings>): string[] {
  if (i === 0 || !tl.snapshots[i]) return [];
  const b = d.bindings;
  const ev = eventsAt(tl, i, shownId(tl, b, i), b.kind);
  const now = tl.snapshots[i];
  const was = tl.snapshots[i - 1];
  const lines = ev.lookups.map((l) => {
    const result = !l.found ? 'miss' : l.value === undefined ? 'hit' : `hit (${hudText(tl, now, l.value)})`;
    return `lookup ${hudText(tl, now, l.key)} → ${result}`;
  });
  const changeLine = (c: Change): string | null => {
    const key = hudText(tl, c.kind === 'removed' ? was : now, c.kind === 'removed' ? c.before.key : c.after.key);
    if (b.kind === 'set') return c.kind === 'updated' ? null : `${d.title}.${c.kind === 'added' ? 'add' : 'delete'}(${key})`;
    if (c.kind === 'added') return `added ${key} → ${hudText(tl, now, c.after.value)}`;
    if (c.kind === 'updated') return `updated ${key}: ${hudText(tl, was, c.before.value)} → ${hudText(tl, now, c.after.value)}`;
    return `removed ${key}`;
  };
  if (!ev.created) {
    const removed = ev.changes.filter((c) => c.kind === 'removed');
    if (ev.cleared) lines.push(`${d.title}.clear(): ${removed.length} removed`);
    for (const c of ev.changes) {
      const line = ev.cleared && c.kind === 'removed' ? null : changeLine(c);
      if (line) lines.push(line);
    }
  }
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), `… ${lines.length - MAX_LINES + 1} more`] : lines;
}
