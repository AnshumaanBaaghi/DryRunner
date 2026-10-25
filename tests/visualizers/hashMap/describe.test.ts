/** Hash-map HUD lines: lookups (hit with the value found, or miss) and the entries a step added, updated or removed. */
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../../src/engine/detect/analysis';
import { exampleById } from '../../../src/examples';
import { hashMapVisualizer } from '../../../src/visualizers/hashMap';
import { timelineOf } from '../../helpers/timeline';

/** Every non-empty HUD block of the run, in order, per detection. */
async function hud(source: string): Promise<Record<string, string[][]>> {
  const tl = await timelineOf(source);
  const out: Record<string, string[][]> = {};
  for (const d of hashMapVisualizer.detect({ tl, analysis: analyzeTrace(tl) })) {
    expect(hashMapVisualizer.describe!(tl, 0, d)).toEqual([]);
    out[d.title] = tl.steps.map((_, i) => hashMapVisualizer.describe!(tl, i, d)).filter((lines) => lines.length > 0);
  }
  return out;
}

describe('hash map describe', () => {
  it('longest-substring: a miss before each first sighting, then hits and updates', async () => {
    const { lastSeen } = await hud(exampleById('longest-substring')!.code);
    expect(lastSeen.every((b) => b.length === 1)).toBe(true);
    expect(lastSeen.flat().slice(0, 12)).toEqual([
      "lookup 'a' → miss", "added 'a' → 0", "lookup 'b' → miss", "added 'b' → 1", "lookup 'c' → miss", "added 'c' → 2",
      "lookup 'a' → hit (0)", "lookup 'a' → hit (0)", "updated 'a': 0 → 3", "lookup 'b' → hit (1)", "lookup 'b' → hit (1)", "updated 'b': 1 → 4",
    ]);
    expect(lastSeen.flat().at(-1)).toBe("updated 'b': 6 → 7");
  });

  it('bfs / dfs: Set lookups and adds, the value it was created with left to the narration', async () => {
    const { visited } = await hud(exampleById('bfs')!.code);
    expect(visited.flat().slice(0, 5)).toEqual(['lookup 1 → miss', 'visited.add(1)', 'lookup 2 → miss', 'visited.add(2)', 'lookup 0 → hit']);
    expect(visited.flat().filter((l) => l.includes('.add(')).length).toBe(5);
    const dfs = await hud(exampleById('dfs')!.code);
    expect(dfs.visited.flat().slice(0, 3)).toEqual(["visited.add('A')", "lookup 'B' → miss", "visited.add('B')"]);
  });

  it('removals, clear() and plain-object writes', async () => {
    const lines = await hud(`const m = new Map([['x', 1]]);
m.set('y', 2);
m.set('x', 5);
m.delete('y');
m.clear();
const s = new Set([1, 2]);
s.delete(1);
const o = {};
o.a = [1, 2];
o.b = o.a.length;
delete o.a;`);
    expect(lines.m).toEqual([["added 'y' → 2"], ["updated 'x': 1 → 5"], ["removed 'y'"], ['m.clear(): 1 removed']]);
    expect(lines.s).toEqual([['s.delete(1)']]);
    expect(lines.o).toEqual([["added 'a' → [1, 2]"], ["lookup 'a' → hit ([1, 2])", "added 'b' → 2"], ["removed 'a'"]]);
  });

  it('counts the lookups that do not fit', async () => {
    const { s } = await hud(`const s = new Set([1, 2, 3, 4, 5]);
const all = s.has(1) && s.has(2) && s.has(3) && s.has(4) && s.has(5);`);
    expect(s).toEqual([['lookup 1 → hit', 'lookup 2 → hit', 'lookup 3 → hit', '… 2 more']]);
  });
});
