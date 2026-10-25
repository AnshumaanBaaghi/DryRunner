/** Bars (numbers) or blocks (strings/mixed) with pointer markers, window / search interval and swap motion. */
import { animated, useSpring, type SpringValue } from '@react-spring/three';
import { useEffect, useMemo, useRef } from 'react';
import { useAnimTiming, useHighlight } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Arrow } from '../../scene/primitives/Arrow';
import { Bar } from '../../scene/primitives/Bar';
import { Block } from '../../scene/primitives/Block';
import { DeltaLabel } from '../../scene/primitives/DeltaLabel';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker, WindowBox } from '../../scene/primitives/Markers';
import { COLORS } from '../../scene/primitives/materials';
import { usePulse } from '../../scene/primitives/pulse';
import type { VizProps } from '../types';
import type { ArrayBindings } from './detect';
import { buildArrayModel, MAX_BAR, SPACING, type ElemModel } from './model';

const MODE_LABEL: Record<string, string> = {
  sorting: 'sorting', window: 'sliding window', 'two-pointers': 'two pointers', 'binary-search': 'binary search', pointers: '', plain: '',
};

const HOP = 0.62;

/** Elements trading places pass each other: the one moving right swings forward, the other back. */
function useHop(index: number): SpringValue<number> {
  const timing = useAnimTiming();
  const prev = useRef(index);
  const [spring, api] = useSpring(() => ({ z: 0 }));
  useEffect(() => {
    const from = prev.current;
    prev.current = index;
    if (from === index || timing.immediate || timing.direction === 'jump') return;
    const half = Math.max(30, Number(timing.config.duration ?? 400) / 2);
    api.start({ to: [{ z: index > from ? HOP : -HOP }, { z: 0 }], config: { duration: half } });
  }, [index, api, timing]);
  return spring.z;
}

function BarElem({ e, height, stepKey, showLabel }: { e: ElemModel; height: number; stepKey: string; showLabel: boolean }) {
  const timing = useAnimTiming();
  const pulse = usePulse(stepKey, e.pulse);
  const hop = useHop(e.index);
  return (
    <animated.group position-z={hop}>
      <Bar x={e.x} height={height} color={e.color} pulse={pulse} timing={timing} />
      {showLabel && <Label text={e.label} position={[e.x, Math.max(height, 0) + 0.32, 0.1]} size={0.26} billboard />}
    </animated.group>
  );
}

function BlockElem({ e, stepKey }: { e: ElemModel; stepKey: string }) {
  const timing = useAnimTiming();
  const pulse = usePulse(stepKey, e.pulse);
  const hop = useHop(e.index);
  return (
    <animated.group position-z={hop}>
      <Block position={[e.x, 0.48, 0]} size={[0.92, 0.92, 0.92]} color={e.color} pulse={pulse} label={e.label} timing={timing} />
    </animated.group>
  );
}

export function ArrayView({ view, detection }: VizProps<ArrayBindings>) {
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const b = detection.bindings;
  const model = useMemo(() => buildArrayModel(view.tl, view.i, b, detection.mode, hl), [view, b, detection.mode, hl]);
  const width = model.maxLen * SPACING;
  const maxH = model.bars ? MAX_BAR : 1;
  const heightOf = (n: number | null) => (n === null || model.maxAbs === 0 ? 0.08 : 0.18 + (MAX_BAR - 0.18) * (n / model.maxAbs));
  useReportSize({ w: width + 1.2, h: maxH + 2.2, d: 1.6 });
  const focusX = model.focusIndex !== null ? model.elems[model.focusIndex]?.x ?? null : null;
  useFocusPoint(detection.key, focusX === null ? null : [focusX, maxH * 0.5, 0], 2, hl?.key ?? '');
  const labels = model.maxLen <= 40;
  const stepKey = hl?.key ?? String(view.i);
  const modeLabel = MODE_LABEL[detection.mode ?? ''];
  const pairA = model.pair ? model.elems[model.pair.a] : undefined;
  const pairB = model.pair ? model.elems[model.pair.b] : undefined;
  // arcs start just above the value labels
  const arcY = (e: ElemModel) => (model.bars ? Math.max(0.1, heightOf(e.num)) + 0.62 : 1.18);
  return (
    <group>
      <Label
        text={`${detection.title}${modeLabel ? ` · ${modeLabel}` : ''}`}
        position={[-width / 2 - 0.2, maxH + 1.55, 0]}
        anchorX="left"
        size={0.32}
        color={COLORS.inkDim}
      />
      {!model.exists && <Label text="(not created yet)" position={[0, 0.5, 0]} size={0.28} color={COLORS.inkFaint} />}
      {model.window && (
        <WindowBox from={model.window.from} to={model.window.to} spacing={SPACING} height={maxH + 0.35} timing={timing}
          label={`window [${model.window.from}, ${model.window.to}]`} offset={-(model.maxLen - 1) / 2} />
      )}
      {model.interval && (
        <WindowBox from={model.interval.from} to={model.interval.to} spacing={SPACING} height={maxH + 0.35} color={COLORS.frontier} timing={timing}
          label={`[${model.interval.from}, ${model.interval.to}]`} offset={-(model.maxLen - 1) / 2} />
      )}
      {model.elems.map((e) => (model.bars
        ? <BarElem key={e.key} e={e} height={heightOf(e.num)} stepKey={stepKey} showLabel={labels} />
        : <BlockElem key={e.key} e={e} stepKey={stepKey} />))}
      {labels && model.elems.map((e) => (
        <Label key={`ix${e.index}`} text={String(e.index)} position={[e.x, -0.32, 0.45]} size={0.2} color={COLORS.inkFaint} />
      ))}
      {model.pointers.map((p) => (
        <PointerMarker key={p.name} x={p.x} y={maxH + 0.4} label={p.name} color={p.color} stack={p.stack} timing={timing} />
      ))}
      {model.pair && pairA && pairB && (
        <Arrow
          key={`${model.pair.kind}:${model.pair.a}:${model.pair.b}`}
          from={[pairA.x, arcY(pairA), 0]}
          to={[pairB.x, arcY(pairB), 0]}
          color={model.pair.kind === 'swap' ? COLORS.changed : COLORS.current}
          head={false}
          radius={0.032}
          bend={Math.min(1.2, 2.4 / Math.max(0.5, Math.abs(pairB.x - pairA.x)))}
          glow={1.5}
        />
      )}
      {model.delta && model.elems[model.delta.index] && (
        <DeltaLabel
          position={[model.elems[model.delta.index].x, (model.bars ? Math.max(0.4, heightOf(model.elems[model.delta.index].num)) : 1) + 0.75, 0.6]}
          text={model.delta.text}
          changeKey={stepKey}
        />
      )}
    </group>
  );
}
