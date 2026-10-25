/**
 * Tree: nodes as spheres at stable tidy-tree positions (they never move; new ones drop in) joined by lines
 * from parent to child. The node the active traversal call works on glows amber, the calls above it light
 * the path blue, visited nodes turn green (showing what their call returned), the rest stay idle. A call
 * that reached a missing child shows "null" there, the link written this step glows orange, pointer
 * variables float above their nodes and the visit order fills a strip of blocks under the tree.
 */
import { animated } from '@react-spring/three';
import { useMemo } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useDrop } from '../../scene/drop';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Block } from '../../scene/primitives/Block';
import { Edges, type EdgeSpec } from '../../scene/primitives/Edges';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker } from '../../scene/primitives/Markers';
import { COLORS } from '../../scene/primitives/materials';
import { NodeSphere } from '../../scene/primitives/NodeSphere';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { TreeBindings } from './detect';
import {
  buildTreeModel, MARKER_LIFT, NODE_R, STRIP_BLOCK, STRIP_PITCH, VISITED_COLOR, type NodeModel, type StripModel, type TreeFrame,
} from './model';

const EDGE_Z = -0.02;

/** font size that fits a label on a node / block face (a character is about 0.6 × the size wide) */
const fit = (label: string, width: number, max: number) => Math.min(max, (width - 0.14) / (0.6 * Math.max(1, label.length)));

function TreeNodeView({ node, stepKey, timing }: { node: NodeModel; stepKey: string; timing: AnimTiming }) {
  const current = node.state === 'current';
  const pulse = usePulse(`${stepKey}:${node.id}`, current || node.isNew, node.glow, 2.8);
  const drop = useDrop(stepKey, node.isNew, timing);
  return (
    <animated.group position-y={drop}>
      <NodeSphere position={[node.pos[0], node.pos[1], 0]} radius={NODE_R} color={node.color} glow={node.glow}
        pulse={current || node.isNew ? pulse : undefined} timing={timing}>
        <Label text={node.label} position={[0, 0, NODE_R + 0.02]} size={fit(node.label, 2 * NODE_R, 0.3)} />
        {node.badge && <Label text={node.badge} position={[0, -NODE_R - 0.24, 0.05]} size={0.22} color={COLORS.done} />}
      </NodeSphere>
    </animated.group>
  );
}

function StripBlock({ x, y, label, pulse, pulseKey, timing }: { x: number; y: number; label: string; pulse: boolean; pulseKey: string; timing: AnimTiming }) {
  const glow = usePulse(pulseKey, pulse);
  return (
    <Block position={[x, y, 0]} size={[STRIP_BLOCK, STRIP_BLOCK, 0.3]} color={pulse ? COLORS.changed : VISITED_COLOR} pulse={glow} label={label}
      labelSize={fit(label, STRIP_BLOCK, 0.22)} timing={timing} />
  );
}

/** The visit order: one block per value, in the order visited; the one pushed this step pulses orange. */
function VisitStrip({ strip, band, stepKey, timing }: { strip: StripModel; band: NonNullable<TreeFrame['strip']>; stepKey: string; timing: AnimTiming }) {
  const left = band.x0 - STRIP_BLOCK / 2;
  return (
    <group>
      <Label text={`visit order · ${strip.name}`} position={[left, band.y + 0.55, 0]} anchorX="left" size={0.24} color={COLORS.inkDim} />
      {strip.items.map((item, k) => (
        <StripBlock key={k} x={band.x0 + k * STRIP_PITCH} y={band.y} label={item.label} pulse={item.pulse} pulseKey={`${stepKey}:${k}`} timing={timing} />
      ))}
      {strip.more > 0 && (
        <Label text={`+${strip.more}`} position={[band.x0 + band.len * STRIP_PITCH, band.y, 0]} anchorX="left" size={0.22} color={COLORS.inkFaint} />
      )}
    </group>
  );
}

export function TreeView({ view, detection }: VizProps<TreeBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const model = useMemo(() => buildTreeModel(view.tl, view.i, b, hl), [view, b, hl]);
  const { frame, nullAt } = model;
  useReportSize({ w: frame.width, h: frame.height, d: 1.4 });
  const stepKey = hl?.key ?? String(view.i);
  useFocusPoint(detection.key, model.focus ? [model.focus[0], model.focus[1], 0] : null, 2, stepKey);

  const edges = useMemo(() => {
    const out: EdgeSpec[] = model.edges.map((e) => {
      const [px, py] = frame.pos.get(e.parent)!;
      const [cx, cy] = frame.pos.get(e.child)!;
      return { from: [px, py, EDGE_Z], to: [cx, cy, EDGE_Z], color: e.color };
    });
    if (nullAt?.parent) {
      // a stub toward the "null" the active call got
      const [px, py] = nullAt.parent;
      const [nx, ny] = nullAt.pos;
      out.push({ from: [px, py, EDGE_Z], to: [px + (nx - px) * 0.7, py + (ny - py) * 0.7, EDGE_Z], color: COLORS.current });
    }
    return out;
  }, [model.edges, frame, nullAt]);

  return (
    <group>
      <Label text={`${detection.title} · tree`} position={[-frame.width / 2 + 0.2, frame.titleY, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      {!model.nodes.length && <Label text="(no nodes yet)" position={[0, frame.height / 2, 0]} size={0.28} color={COLORS.inkFaint} />}
      <Edges edges={edges} width={2.4} />
      {model.nodes.map((node) => <TreeNodeView key={node.id} node={node} stepKey={stepKey} timing={timing} />)}
      {nullAt && <Label text="null" position={[nullAt.pos[0], nullAt.pos[1], 0.05]} size={0.22} color={COLORS.current} />}
      {model.pointers.map((p) => {
        const [x, y] = frame.pos.get(p.node)!;
        return <PointerMarker key={p.id} x={x} y={y + MARKER_LIFT} label={p.name} color={p.color} stack={p.stack} timing={timing} />;
      })}
      {model.strip && frame.strip && <VisitStrip strip={model.strip} band={frame.strip} stepKey={stepKey} timing={timing} />}
      {frame.hidden > 0 && (
        <Label text={`+${frame.hidden} more`} position={[frame.width / 2 - 0.2, frame.titleY, 0]} anchorX="right" size={0.24} color={COLORS.inkFaint} />
      )}
    </group>
  );
}
