/**
 * Graph: nodes as spheres at stable force-layout positions with their ids on them, edges as lines
 * (undirected) or arrows (directed / weighted, the weight beside the middle). The node being expanded
 * glows amber and pulses, frontier nodes are violet, visited ones blue (with their visit order); the edge
 * being examined glows amber and adjacency entries flash orange as they are added. Distances mode: a
 * `d=4` badge under every node and an "old → new" tag when one is relaxed.
 */
import { animated } from '@react-spring/three';
import { useMemo } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Arrow } from '../../scene/primitives/Arrow';
import { DeltaLabel } from '../../scene/primitives/DeltaLabel';
import { Edges, type EdgeSpec } from '../../scene/primitives/Edges';
import { Label } from '../../scene/primitives/Label';
import { COLORS } from '../../scene/primitives/materials';
import { NodeSphere } from '../../scene/primitives/NodeSphere';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { GraphBindings } from './detect';
import { edgeShape, frameOf } from './geometry';
import { buildGraphModel, type EdgeModel, type EdgeState, type NodeModel } from './model';

const AnimatedArrow = animated(Arrow);
const EDGE_COLOR: Record<EdgeState, string> = { idle: '#4a5b7c', added: COLORS.changed, examined: COLORS.current };
const TITLE_SIZE = 0.32;

function GraphNode({ node, radius, stepKey, timing, distances }: {
  node: NodeModel;
  radius: number;
  stepKey: string;
  timing: AnimTiming;
  distances: boolean;
}) {
  const pulse = usePulse(`${stepKey}:${node.id}`, node.pulse, node.glow, 2.6);
  // longer ids shrink to fit the sphere (a character is about 0.6 × the font size wide)
  const size = Math.min(0.3, (1.7 * radius) / (0.6 * Math.max(1, node.label.length)));
  return (
    <NodeSphere position={node.pos} radius={radius} color={node.color} glow={node.glow} pulse={pulse} timing={timing}>
      <Label text={node.label} position={[0, 0, radius + 0.02]} size={size} />
      {!distances && node.order !== null && (
        <Label text={String(node.order)} position={[radius * 0.9, radius * 0.9, 0.06]} size={0.17} color={COLORS.inkDim} />
      )}
      {distances && node.dist !== null && (
        <Label text={`d=${node.dist}`} position={[0, -radius - 0.22, 0.06]} size={0.22} color={node.relax ? COLORS.changed : COLORS.inkDim} />
      )}
      {node.relax && <DeltaLabel position={[0, radius + 0.45, 0.06]} text={node.relax} changeKey={`${stepKey}:${node.id}`} />}
    </NodeSphere>
  );
}

/** An edge as an arrow (directed) or a tube (weighted); lit ones glow. Lines carry the rest (see GraphView). */
function EdgeArrow({ edge, radius, head, twoWay, stepKey }: { edge: EdgeModel; radius: number; head: boolean; twoWay: boolean; stepKey: string }) {
  const shape = edgeShape(edge.a, edge.b, radius, twoWay);
  const lit = edge.state !== 'idle';
  const glow = usePulse(`${stepKey}:${edge.key}`, edge.pulse, lit ? 1.4 : 0.25, 2.8);
  const color = EDGE_COLOR[edge.state];
  return (
    <group>
      <AnimatedArrow from={shape.from} to={shape.to} bend={shape.bend} color={color} radius={lit ? 0.045 : 0.03} head={head} headSize={0.2}
        glow={glow} />
      {edge.weight !== null && <Label text={edge.weight} position={shape.label} size={0.22} color={lit ? color : COLORS.inkDim} />}
    </group>
  );
}

export function GraphView({ view, detection }: VizProps<GraphBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const model = useMemo(() => buildGraphModel(view.tl, view.i, b, hl), [view, b, hl]);
  const { layout } = model.frame;
  const title = `${detection.title} · graph`;
  const box = frameOf(layout, title.length * TITLE_SIZE * 0.6);
  useReportSize({ w: box.w, h: box.h, d: box.d });
  const stepKey = hl?.key ?? String(view.i);
  useFocusPoint(detection.key, model.focus, 2, stepKey);
  // undirected, unweighted: one draw call of lines, tubes only over the lit edges (and loops, which no line draws)
  const tubes = b.directed || b.weighted;
  const lines = useMemo(() => (tubes ? [] : model.edges.map((e): EdgeSpec => ({ from: e.a, to: e.b, color: EDGE_COLOR[e.state] }))), [tubes, model.edges]);
  const drawn = useMemo(() => new Set(model.edges.map((e) => `${e.from}>${e.to}`)), [model.edges]);
  const r = layout.radius;
  return (
    <group>
      <Label text={title} position={box.title} anchorX="left" size={TITLE_SIZE} color={COLORS.inkDim} />
      {!model.exists && <Label text="(not created yet)" position={[0, layout.height / 2, 0]} size={0.28} color={COLORS.inkFaint} />}
      {!tubes && <Edges edges={lines} width={2.4} />}
      {model.edges.filter((e) => tubes || e.state !== 'idle' || e.from === e.to).map((e) => (
        <EdgeArrow key={e.key} edge={e} radius={r} head={b.directed} twoWay={b.directed && e.from !== e.to && drawn.has(`${e.to}>${e.from}`)}
          stepKey={stepKey} />
      ))}
      {model.exists && model.nodes.map((n) => (
        <GraphNode key={n.id} node={n} radius={r} stepKey={stepKey} timing={timing} distances={detection.mode === 'distances'} />
      ))}
    </group>
  );
}
