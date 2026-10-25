/**
 * Linked list: nodes as blocks at stable slots and links as arrows — straight to a right-hand neighbor,
 * arcing over the row to nodes further right and under it to nodes further left, so reversing the list
 * visibly flips them. A null `next` ends in a small "null"; the link written this step pulses orange while
 * the arrow it replaced fades; pointer variables float above their nodes (null ones over a "null" slot
 * past the end) and new nodes drop in.
 */
import { animated, useSpring } from '@react-spring/three';
import { useMemo } from 'react';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useDrop } from '../../scene/drop';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Arrow } from '../../scene/primitives/Arrow';
import { Block } from '../../scene/primitives/Block';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker } from '../../scene/primitives/Markers';
import { COLORS } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { LinkedListBindings } from './detect';
import { bandsOf, BLOCK, linkArc, nullStub, xOf, type ArcSpec, type Vec3 } from './geometry';
import { buildListModel, MAX_SLOTS, type LinkChange, type NodeModel } from './model';

type LinkKey = LinkChange['key'];

const AnimatedArrow = animated(Arrow);
const LINK_COLOR: Record<LinkKey, string> = { next: COLORS.visited, prev: COLORS.frontier };
const LINK_RADIUS: Record<LinkKey, number> = { next: 0.04, prev: 0.03 };

function NodeBlock({ node, x, y, stepKey, timing }: { node: NodeModel; x: number; y: number; stepKey: string; timing: AnimTiming }) {
  const pulse = usePulse(stepKey, node.pulse);
  const drop = useDrop(stepKey, node.isNew, timing);
  // long values shrink to fit the block (a character is about 0.6 × the font size wide)
  const size = Math.min(0.3, (BLOCK[0] - 0.12) / (0.6 * Math.max(1, node.label.length)));
  return (
    <animated.group position-y={drop}>
      <Block position={[x, y, 0]} size={BLOCK} color={node.color} pulse={pulse} label={node.label} labelSize={size} timing={timing} />
    </animated.group>
  );
}

/** One node's link; the one written this step glows orange. A null `next` is a stub ending in "null". */
function Link({ arc, kind, changed, pulseKey, nullAt }: { arc: ArcSpec; kind: LinkKey; changed: boolean; pulseKey: string; nullAt?: Vec3 }) {
  const glow = usePulse(pulseKey, changed, 0.35, 2.6);
  const color = changed ? COLORS.changed : nullAt ? COLORS.inkFaint : LINK_COLOR[kind];
  return (
    <group>
      <AnimatedArrow from={arc.from} to={arc.to} bend={arc.bend} color={color} radius={LINK_RADIUS[kind]} headSize={0.18} glow={glow} />
      {nullAt && <Label text="null" position={nullAt} size={0.2} color={changed ? COLORS.changed : COLORS.inkFaint} />}
    </group>
  );
}

/** The arrow a write replaced, fading out (mounted per step key, so every change replays it). */
function FadingLink({ arc, kind, timing }: { arc: ArcSpec; kind: LinkKey; timing: AnimTiming }) {
  const spring = useSpring({ from: { o: 0.8 }, to: { o: 0 }, config: timing.config });
  return (
    <animated.group visible={spring.o.to((o) => o > 0.01)}>
      <AnimatedArrow from={arc.from} to={arc.to} bend={arc.bend} color={LINK_COLOR[kind]} radius={LINK_RADIUS[kind]} headSize={0.18}
        opacity={spring.o} glow={0.5} />
    </animated.group>
  );
}

export function LinkedListView({ view, detection }: VizProps<LinkedListBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const model = useMemo(() => buildListModel(view.tl, view.i, b, hl), [view, b, hl]);
  const { frame } = model;
  const n = frame.slotCount;
  const bands = bandsOf(frame);
  useReportSize({ w: bands.width, h: bands.height, d: 1.6 });
  const stepKey = hl?.key ?? String(view.i);
  useFocusPoint(detection.key, model.focusSlot === null ? null : [xOf(model.focusSlot, n), bands.rowY, 0], 2, stepKey);

  const changed = (slot: number, key: LinkKey) => model.changes.some((c) => c.from === slot && c.key === key && c.now !== undefined);
  const arcTo = (from: number, to: number | null, key: LinkKey): ArcSpec & { label?: Vec3 } =>
    to === null ? nullStub(from, n, bands.rowY) : linkArc(from, to, key, n, bands.rowY);
  const link = (node: NodeModel, key: LinkKey) => {
    const to = node[key];
    // only `next` shows where a list ends
    if (to === undefined || (to === null && key === 'prev')) return null;
    const arc = arcTo(node.slot, to, key);
    return (
      <Link key={`${node.id}:${key}`} arc={arc} kind={key} changed={changed(node.slot, key)} pulseKey={`${stepKey}:${node.id}:${key}`}
        nullAt={arc.label} />
    );
  };
  // the arrow a write replaced (a null `prev` never had one)
  const replaced = (c: LinkChange) =>
    (c.was === undefined || c.was === c.now || (c.was === null && c.key === 'prev') ? null : arcTo(c.from, c.was, c.key));

  return (
    <group>
      <Label text={`${detection.title} · linked list`} position={[-bands.width / 2 + 0.2, bands.titleY, 0]} anchorX="left" size={0.32}
        color={COLORS.inkDim} />
      {!model.nodes.length && <Label text="(not created yet)" position={[0, bands.rowY, 0]} size={0.28} color={COLORS.inkFaint} />}
      {model.nodes.map((node) => <NodeBlock key={node.id} node={node} x={xOf(node.slot, n)} y={bands.rowY} stepKey={stepKey} timing={timing} />)}
      {model.nodes.map((node) => link(node, 'next'))}
      {b.prevKey && model.nodes.map((node) => link(node, 'prev'))}
      {!timing.immediate && model.changes.map((c, k) => {
        const arc = replaced(c);
        return arc && <FadingLink key={`${stepKey}:${k}`} arc={arc} kind={c.key} timing={timing} />;
      })}
      {model.nullUsed && <Label text="null" position={[xOf(frame.nullSlot, n), bands.rowY, 0]} size={0.3} color={COLORS.inkFaint} />}
      {frame.hidden > 0 && (
        <Label text={`+${frame.hidden} more`} position={[xOf(MAX_SLOTS, n), bands.rowY, 0]} size={0.24} color={COLORS.inkFaint} />
      )}
      {model.pointers.map((p) => (
        <PointerMarker key={p.id} x={xOf(p.slot, n)} y={bands.markerY} label={p.name} color={p.color} stack={p.stack} timing={timing} />
      ))}
    </group>
  );
}
