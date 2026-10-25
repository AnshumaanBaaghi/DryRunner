/**
 * Backtracking: the decision tree — each edge labelled with the choice that led to the call, solutions
 * glowing green, dead ends fading red — with what the choices build (the path, the board or the flags)
 * and the solutions so far in a panel to its right. The composition is centered on x = 0.
 */
import { useCallback, useMemo } from 'react';
import { isUndef } from '../../engine/types/values';
import { useAnimTiming, useHighlight } from '../../scene/anim';
import { useReportSize } from '../../scene/layout';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { buildCallTree, hasReturned, type NodePhase, type TreeNode } from '../shared/callTree';
import { CallTreeView } from '../shared/CallTreeView';
import { useCallTreeLayout } from '../shared/treeState';
import type { VizProps } from '../types';
import type { BacktrackBindings } from './detect';
import { buildPanel, nodeLabels, nodeLook, nodeMark, nodeWidth, short, treeInfo } from './model';
import { PANEL_GAP, panelLayout } from './panel';
import { PanelView } from './PanelView';

/** levels far enough apart for a badge, an edge label and the next label between them */
const DY = 2;
/** deepest level: its badges stay above y = 0 */
const BOTTOM = 0.95;
/** room above the root's center for its label */
const ROOT_LABEL = 0.85;
const TITLE_H = 0.6;
/** beyond this many visible calls only the active path keeps its choices (as CallTreeView does for labels) */
const EDGE_LABEL_BUDGET = 160;

export function BacktrackingView({ view, detection }: VizProps<BacktrackBindings>) {
  const { tl } = view;
  const b = detection.bindings;
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  // both are cached per timeline length, so they follow a timeline that is still streaming in
  const tree = buildCallTree(tl, b.fnIds);
  const info = treeInfo(tl, tree, b);
  const labels = useMemo(() => nodeLabels(tl, tree), [tl, tree]);
  const widthOf = useCallback((n: TreeNode) => nodeWidth(labels.get(n.callId) ?? '', info.choice.get(n.callId) ?? ''), [labels, info]);
  const state = useCallTreeLayout(view, tree, { dy: DY, bottom: BOTTOM, widthOf });

  const hasResults = Boolean(b.results);
  const lookOf = useCallback((n: TreeNode, phase: NodePhase) => {
    const returned = hasReturned(n, view.i) && n.value !== undefined && !isUndef(n.value) ? short(tl, view.snap, n.value, 8) : undefined;
    return nodeLook(phase, nodeMark(info, n, view.i, hasResults), labels.get(n.callId) ?? '', returned);
  }, [info, labels, tl, view.i, view.snap, hasResults]);
  const visible = useMemo(() => [...state.layout.pos.keys()].filter((id) => tree.nodes.get(id)!.enterStep <= view.i).length, [state.layout, tree, view.i]);
  const edgeLabelOf = useCallback((n: TreeNode) => (
    visible <= EDGE_LABEL_BUDGET || state.path.has(n.callId) ? info.choice.get(n.callId) ?? null : null
  ), [visible, state.path, info]);

  const panel = useMemo(() => buildPanel(tl, view.i, b, info, hl), [tl, view.i, b, info, hl]);
  const geo = panelLayout(panel, b.mode);
  const hasTree = state.layout.pos.size > 0;
  const treeW = hasTree ? state.layout.width : 0;
  const gap = hasTree ? PANEL_GAP : 0;
  const width = treeW + gap + geo.w;
  const treeH = hasTree ? state.layout.height + ROOT_LABEL : 0;
  // the panel sits level with the middle of the tree
  const panelY = Math.max(0, (treeH - geo.h) / 2);
  const height = Math.max(treeH, panelY + geo.h) + TITLE_H;
  useReportSize({ w: width + 0.4, h: height, d: 1.6 });

  return (
    <group>
      <Label text={`${detection.title} · backtracking`} position={[-width / 2, height - 0.2, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      <CallTreeView view={view} tree={tree} state={state} focusId={detection.key} lookOf={lookOf} edgeLabelOf={edgeLabelOf}
        offset={[-width / 2 + treeW / 2, 0, 0]} />
      <group position={[-width / 2 + treeW + gap, panelY, 0]}>
        <PanelView model={panel} layout={geo} stepKey={hl?.key ?? String(view.i)} timing={timing} />
      </group>
    </group>
  );
}
