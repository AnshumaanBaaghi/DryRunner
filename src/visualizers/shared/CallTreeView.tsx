/**
 * A call tree at the current step: calls appear where they will stay, the active call glows, the path
 * from the root to it is lit, finished calls can show their return value, and "+N" pills stand for calls
 * beyond the node budget (click to expand). Clicking a call jumps to the step that made it.
 * Plugins decide every node's look and may add edge labels and extras under nodes.
 */
import { useCursor } from '@react-three/drei';
import { useMemo, useState, type ReactNode } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { Edges, type EdgeSpec } from '../../scene/primitives/Edges';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { NodeSphere } from '../../scene/primitives/NodeSphere';
import { usePulse } from '../../scene/primitives/pulse';
import { usePlayback } from '../../state/playbackStore';
import type { StepView } from '../../state/selectors';
import { phaseAt, type CallTree, type NodePhase, type TreeNode } from './callTree';
import { LABEL_SIZE, NODE_RADIUS, type NodeLook, type TreeState } from './treeState';

/** beyond this many visible calls only the active path keeps its labels */
const LABEL_BUDGET = 160;

export interface CallTreeViewProps {
  view: StepView;
  tree: CallTree;
  state: TreeState;
  /** focus point id (the detection key) */
  focusId: string;
  lookOf(node: TreeNode, phase: NodePhase): NodeLook;
  /** text on the edge into a node (e.g. the choice that led to it) */
  edgeLabelOf?(node: TreeNode, phase: NodePhase): string | null;
  /** drawn relative to a node's center (e.g. mini-arrays under divide-and-conquer calls) */
  extraOf?(node: TreeNode, phase: NodePhase): ReactNode;
  /** placement of the tree inside the visualizer's slot */
  offset?: [number, number, number];
}

function TreeNodeView({ node, phase, pos, look, showLabel, stepKey, timing, extra }: {
  node: TreeNode;
  phase: NodePhase;
  pos: [number, number];
  look: NodeLook;
  showLabel: boolean;
  stepKey: string;
  timing: AnimTiming;
  extra: ReactNode;
}) {
  const r = look.radius ?? NODE_RADIUS;
  const pulse = usePulse(`${stepKey}:${node.callId}`, phase === 'active', look.glow ?? 0.1, 2.8);
  return (
    <NodeSphere position={[pos[0], pos[1], 0]} radius={r} color={look.color} glow={look.glow} pulse={phase === 'active' ? pulse : undefined}
      opacity={look.opacity ?? 1} timing={timing} onClick={() => usePlayback.getState().goto(node.enterStep)}>
      {showLabel && look.label && <Label text={look.label} position={[0, r + 0.3, 0.05]} size={LABEL_SIZE} color={look.labelColor ?? COLORS.ink} />}
      {look.badge && <Label text={look.badge} position={[0, -r - 0.28, 0.05]} size={0.26} color={look.badgeColor ?? COLORS.done} />}
      {extra}
    </NodeSphere>
  );
}

function HiddenPill({ x, y, count, onClick }: { x: number; y: number; count: number; onClick(): void }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const text = `+${count} more`;
  return (
    <group position={[x, y, 0]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[text.length * 0.13 + 0.3, 0.36, 0.06]} />
        <meshStandardMaterial color={hovered ? '#334155' : '#1e293b'} />
      </mesh>
      <Label text={text} position={[0, 0, 0.05]} size={0.2} color={COLORS.inkDim} outline={false} />
    </group>
  );
}

export function CallTreeView({ view, tree, state, focusId, lookOf, edgeLabelOf, extraOf, offset = [0, 0, 0] }: CallTreeViewProps) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const stepKey = hl?.key ?? String(view.i);
  const { layout, hidden, activeId, path } = state;
  const visible = [...layout.pos.keys()].filter((id) => tree.nodes.get(id)!.enterStep <= view.i);
  const labelAll = visible.length <= LABEL_BUDGET;
  const activePos = activeId !== null ? layout.pos.get(activeId) : undefined;
  useFocusPoint(focusId, activePos ? [activePos[0] + offset[0], activePos[1] + offset[1], offset[2]] : null, 2, stepKey);
  const edges = useMemo(() => {
    const out: EdgeSpec[] = [];
    for (const id of layout.pos.keys()) {
      const n = tree.nodes.get(id)!;
      const from = n.parent === null ? undefined : layout.pos.get(n.parent);
      if (!from || n.enterStep > view.i) continue;
      const to = layout.pos.get(id)!;
      const phase = phaseAt(n, view.i, activeId);
      const color = path.has(id) ? COLORS.current : phase === 'returned' ? '#2c6b52' : phase === 'threw' ? COLORS.error : '#3a4a66';
      out.push({ from: [from[0], from[1], -0.02], to: [to[0], to[1], -0.02], color });
    }
    return out;
  }, [layout, tree, view.i, activeId, path]);
  return (
    <group position={offset}>
      <Edges edges={edges} width={2.2} />
      {visible.map((id) => {
        const n = tree.nodes.get(id)!;
        const phase = phaseAt(n, view.i, activeId);
        const pos = layout.pos.get(id)!;
        const edgeLabel = edgeLabelOf?.(n, phase);
        const from = n.parent === null ? undefined : layout.pos.get(n.parent);
        return (
          <group key={id}>
            <TreeNodeView node={n} phase={phase} pos={pos} look={lookOf(n, phase)} showLabel={labelAll || path.has(id)}
              stepKey={stepKey} timing={timing} extra={extraOf?.(n, phase)} />
            {edgeLabel && from && (
              <Label text={edgeLabel} position={[(from[0] + pos[0]) / 2, (from[1] + pos[1]) / 2, 0.08]} size={0.24}
                color={path.has(id) ? COLORS.current : COLORS.inkDim} />
            )}
          </group>
        );
      })}
      {[...hidden].map(([id, count]) => {
        const pos = layout.pos.get(id);
        if (!pos || tree.nodes.get(id)!.enterStep > view.i) return null;
        return <HiddenPill key={`h${id}`} x={pos[0]} y={pos[1] - 0.95} count={count} onClick={() => state.expand(id)} />;
      })}
    </group>
  );
}
