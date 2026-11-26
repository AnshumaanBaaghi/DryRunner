/**
 * Pure per-step model of the grid-graph view (testable without WebGL). Per cell (row-major): value text, kind,
 * the component it was visited in (-1: not yet), tile color, label color and raise — water deep blue, unvisited
 * land green-brown, visited cells tinted by component and raised a little, walls dark, the current cell amber.
 * A backtracking DFS's cells are tinted while marked (on its path); those it put back keep a faint trail of the
 * tint over their own look. Plus the current cell, this step's probes, marks and unmarks (stepping back: the
 * undone step's), the cells waiting (DFS path / BFS frontier), the counter and where to focus.
 */
import { valueAt } from '../../engine/detect/track';
import type { Timeline } from '../../engine/timeline/types';
import { deref, primitive } from '../../engine/timeline/values';
import type { Highlight } from '../../scene/anim';
import { COLORS } from '../../scene/primitives/materials';
import { cellKey, cellText, EMPTY, mixHex } from '../dp1d/table';
import { kindOf, type Cell, type CellKind, type GridCell } from './cells';
import type { GridGraphBindings } from './detect';
import { currentAt, focusTrail, gridFacts, lastAtOrBefore, markedAt, probesAt, waitingAt, type Current } from './facts';

export const CELL = 0.9;
export const GAP = 0.08;

export const WATER = '#173f6e';
export const LAND = '#6b6a32';
export const WALL = '#1c222c';
export const OTHER = COLORS.idle;
/** visited cells, one hue per component (cycling) */
export const TINTS = ['#2dd4bf', '#f472b6', '#a3e635', '#e879f9', '#fca5a5'] as const;

const VISITED_RAISE = 0.14;
const CURRENT_RAISE = 0.26;
const WALL_RAISE = 0.1;
/** how much of its component's tint a cell a backtracking DFS put back keeps */
const TRAIL = 0.3;

export const tintOf = (comp: number) => TINTS[comp % TINTS.length];

export interface GridModel {
  exists: boolean;
  /** largest size in the trace (a stable board) */
  rows: number;
  cols: number;
  /** row-major, rows × cols */
  text: string[];
  kind: CellKind[];
  /** component (0-based) a cell was visited in, -1 while unvisited (a cell a backtracking DFS put back included) */
  component: number[];
  color: string[];
  ink: string[];
  raise: number[];
  current: Current | null;
  /** cells looked at this step (off-grid probes included, `inside: false`) */
  probes: GridCell[];
  /** cells marked visited this step */
  marked: Cell[];
  /** cells a backtracking DFS put back this step */
  unmarked: Cell[];
  /** the DFS calls below the current one, or the frontier's waiting cells */
  waiting: Cell[];
  counter: { name: string; text: string } | null;
  /** components begun so far */
  components: number;
  focus: Cell | null;
}

const KIND_LOOK: Record<CellKind, { color: string; ink: string; raise: number }> = {
  land: { color: LAND, ink: COLORS.ink, raise: 0 },
  water: { color: WATER, ink: COLORS.inkDim, raise: 0 },
  wall: { color: WALL, ink: COLORS.inkFaint, raise: WALL_RAISE },
  other: { color: OTHER, ink: COLORS.ink, raise: 0 },
};

/** A cell a backtracking DFS visited and put back: its own look with a little of its component's tint. */
export function trailLook(comp: number, kind: CellKind): { color: string; ink: string; raise: number } {
  const own = KIND_LOOK[kind];
  return { ...own, color: mixHex(own.color, tintOf(comp), TRAIL) };
}

function counterOf(tl: Timeline, b: GridGraphBindings, at: number): GridModel['counter'] {
  if (!b.counter) return null;
  const p = at < 0 ? null : primitive(tl, valueAt(tl, b.counter, at));
  return { name: b.counter.name, text: typeof p?.value === 'number' ? String(p.value) : '·' };
}

export function buildGridModel(tl: Timeline, i: number, b: GridGraphBindings, hl: Highlight | null): GridModel {
  const snap = tl.snapshots[i];
  const f = gridFacts(tl, b);
  const outer = snap.heap.get(b.objId)?.elems;
  const current = currentAt(tl, b, f, i);
  // stepping back, the highlighted step is the one just undone
  const hs = hl ? Math.min(hl.reversed ? i + 1 : i, tl.steps.length - 1) : -1;
  const probes = hs < 0 ? [] : probesAt(tl, b, f, hs);
  const marked = hs < 0 ? [] : (f.byStep.get(hs) ?? []).map((m) => ({ r: m.r, c: m.c }));
  const unmarked = hs < 0 ? [] : f.unmarkedAt.get(hs) ?? [];
  const text: string[] = [];
  const kind: CellKind[] = [];
  const component: number[] = [];
  const color: string[] = [];
  const ink: string[] = [];
  const raise: number[] = [];
  for (let r = 0; r < b.rows; r++) {
    const row = deref(snap, outer?.get(r))?.elems;
    for (let c = 0; c < b.cols; c++) {
      const v = row?.get(c);
      const mark = f.byCell.get(cellKey({ r, c }));
      const comp = mark && mark.step <= i ? mark.comp : -1;
      const k = kindOf(v, f.open);
      const isCurrent = current?.inside && current.r === r && current.c === c;
      const look = v === undefined ? { color: EMPTY, ink: COLORS.inkFaint, raise: 0 }
        : isCurrent ? { color: COLORS.current, ink: COLORS.bg, raise: CURRENT_RAISE }
          : comp < 0 ? KIND_LOOK[k]
            : markedAt(f, { r, c }, i) ? { color: tintOf(comp), ink: COLORS.bg, raise: VISITED_RAISE } : trailLook(comp, k);
      text.push(v === undefined ? '' : cellText(tl, snap, v));
      kind.push(k);
      component.push(comp);
      color.push(look.color);
      ink.push(look.ink);
      raise.push(look.raise);
    }
  }
  // nothing to look at this step: the focus stays on the last cell that had something going on
  const trail = focusTrail(tl, b);
  const focus = current?.inside ? current : marked[0] ?? unmarked[0] ?? probes.find((p) => p.inside) ?? trail[lastAtOrBefore(trail, i)];
  return {
    exists: outer !== undefined,
    rows: b.rows,
    cols: b.cols,
    text,
    kind,
    component,
    color,
    ink,
    raise,
    current,
    probes,
    marked,
    unmarked,
    waiting: waitingAt(tl, b, f, i, current),
    counter: counterOf(tl, b, f.lastLive[i]),
    components: lastAtOrBefore(f.begun, i) + 1,
    focus: focus ? { r: focus.r, c: focus.c } : null,
  };
}
