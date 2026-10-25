/** Per-step state of a rendered call tree (layout within the node budget, active path) and node looks. */
import { useMemo, useState } from 'react';
import { COLORS } from '../../scene/primitives/materials';
import type { StepView } from '../../state/selectors';
import { activeNode, displaySet, layoutTree, pathTo, type CallTree, type LayoutOptions, type NodePhase, type TreeLayout } from './callTree';

export const NODE_CAP = 500;
export const NODE_RADIUS = 0.33;
/** node label font size; a character is about 0.6 × this wide (for layout widths) */
export const LABEL_SIZE = 0.3;

export interface TreeState {
  layout: TreeLayout;
  /** shown call → calls hidden below it */
  hidden: Map<number, number>;
  activeId: number | null;
  /** calls from the root to the active one */
  path: Set<number>;
  expand(id: number): void;
}

/** Layout of the calls within the budget; positions stay put while the tree grows step by step. */
export function useCallTreeLayout(view: StepView, tree: CallTree, opts: LayoutOptions = {}, cap = NODE_CAP): TreeState {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const activeId = activeNode(view.tl, tree, view.i);
  const path = useMemo(() => new Set(pathTo(tree, activeId)), [tree, activeId]);
  // the shown set only follows the active call when the tree exceeds the budget
  const budgetActive = tree.nodes.size > cap ? activeId : null;
  const set = useMemo(() => displaySet(tree, cap, budgetActive, expanded), [tree, cap, budgetActive, expanded]);
  const { dy, gap, bottom, widthOf } = opts;
  const layout = useMemo(() => layoutTree(tree, set.ids, { dy, gap, bottom, widthOf }), [tree, set, dy, gap, bottom, widthOf]);
  return { layout, hidden: set.hidden, activeId, path, expand: (id) => setExpanded((e) => new Set(e).add(id)) };
}

export interface NodeLook {
  color: string;
  glow?: number;
  /** call text above the node */
  label: string;
  labelColor?: string;
  /** small text under the node, e.g. "= 5" */
  badge?: string;
  badgeColor?: string;
  opacity?: number;
  radius?: number;
}

/** Default palette: active amber, on-stack blue, finished green (with its value). */
export function defaultLook(phase: NodePhase): Omit<NodeLook, 'label'> {
  switch (phase) {
    case 'active': return { color: COLORS.current, glow: 1.25 };
    case 'waiting': return { color: COLORS.visited, glow: 0.35 };
    case 'returned': return { color: '#1f7a4d', glow: 0.18, badgeColor: COLORS.done };
    case 'threw': return { color: COLORS.error, glow: 0.6, badgeColor: COLORS.error };
    default: return { color: COLORS.idle, glow: 0, opacity: 0 };
  }
}
