/**
 * Memoized recursion: the call tree — cache hits as violet leaves marked "cached", results shown on the
 * calls that stored them — with the cache in a panel to its right: one card per entry, stored entries
 * dropping in, the entry a hit reads flashing violet. The composition is centered on x = 0.
 */
import { useCallback, useMemo } from 'react';
import { useAnimTiming, useHighlight } from '../../scene/anim';
import { useReportSize } from '../../scene/layout';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { buildCallTree, type NodePhase, type TreeNode } from '../shared/callTree';
import { CallTreeView } from '../shared/CallTreeView';
import { useCallTreeLayout } from '../shared/treeState';
import type { VizProps } from '../types';
import { CacheView } from './CacheView';
import type { MemoBindings } from './detect';
import { buildCache, cacheExtent, finalBadge, memoInfo, nodeLook, nodeTexts, nodeWidth } from './model';
import { cacheLayout } from './panel';

/** levels far enough apart for a badge and the next label between them */
const DY = 1.75;
/** deepest level: its badges stay above y = 0 */
const BOTTOM = 0.9;
/** room above the root's center for its label */
const ROOT_LABEL = 0.85;
const TITLE_H = 0.6;
const PANEL_GAP = 1.5;

export function MemoView({ view, detection }: VizProps<MemoBindings>) {
  const { tl } = view;
  const b = detection.bindings;
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  // all cached per timeline length, so they follow a timeline that is still streaming in
  const tree = buildCallTree(tl, b.fnIds);
  const info = memoInfo(tl, tree, b);
  const texts = nodeTexts(tl, tree, info);
  const widthOf = useCallback((n: TreeNode) => {
    const value = texts.values.get(n.callId) ?? '';
    return nodeWidth(texts.labels.get(n.callId) ?? '', finalBadge(n, info.calls.get(n.callId), value));
  }, [texts, info]);
  const state = useCallTreeLayout(view, tree, { dy: DY, bottom: BOTTOM, widthOf });
  const lookOf = useCallback((n: TreeNode, phase: NodePhase) => (
    nodeLook(phase, n, view.i, info.calls.get(n.callId), texts.labels.get(n.callId) ?? '', texts.values.get(n.callId) ?? '')
  ), [info, texts, view.i]);

  const cache = useMemo(() => buildCache(tl, view.i, b, info, hl), [tl, view.i, b, info, hl]);
  const geo = cacheLayout(cacheExtent(tl, b, info), b.cache.name);
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
      <Label text={`${detection.title} · memoized recursion`} position={[-width / 2, height - 0.2, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      <CallTreeView view={view} tree={tree} state={state} focusId={detection.key} lookOf={lookOf} offset={[-width / 2 + treeW / 2, 0, 0]} />
      <group position={[-width / 2 + treeW + gap, panelY, 0]}>
        <CacheView model={cache} layout={geo} stepKey={hl?.key ?? String(view.i)} timing={timing} />
      </group>
    </group>
  );
}
