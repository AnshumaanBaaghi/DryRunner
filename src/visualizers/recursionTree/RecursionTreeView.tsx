/**
 * Recursion tree: calls appear as they are made, the active call glows, finished calls show what they
 * returned. Divide-and-conquer calls are drawn as their sub-arrays, which re-order into the returned
 * (sorted) array when the call finishes; the combining helper (merge) gets a panel with its pointers.
 */
import { animated, useSpring } from '@react-spring/three';
import { useCallback, useMemo } from 'react';
import { previewValue } from '../../engine/timeline/values';
import type { V } from '../../engine/types/values';
import { useAnimTiming, useHighlight, type AnimTiming } from '../../scene/anim';
import { useFocusPoint } from '../../scene/focus';
import { useReportSize } from '../../scene/layout';
import { Label } from '../../scene/primitives/Label';
import { PointerMarker } from '../../scene/primitives/Markers';
import { COLORS } from '../../scene/primitives/materials';
import type { StepView } from '../../state/selectors';
import { buildArrayModel } from '../array/model';
import { buildCallTree, constantArgs, hasReturned, type NodePhase, type TreeNode } from '../shared/callTree';
import { CallTreeView } from '../shared/CallTreeView';
import { defaultLook, LABEL_SIZE, useCallTreeLayout, type NodeLook } from '../shared/treeState';
import type { VizProps } from '../types';
import type { RecursionBindings } from './detect';
import { dcArrays, runningCall, shortLabel, sortMoves, type DcArrays } from './model';

const CELL = 0.46;
const PITCH = 0.52;
const PANEL_PITCH = 0.64;
const ROW_H = 1.45;
/** vertical space between the tree and the merge panel below it */
const PANEL_GAP = 0.9;

const PHASE_TINT: Record<NodePhase, string> = {
  active: '#8a6417', waiting: '#1f3b70', returned: '#1b6b45', threw: '#7a2323', future: '#1b2535',
};

function MiniCell({ x, label, color, glow, timing }: { x: number; label: string; color: string; glow: number; timing: AnimTiming }) {
  const spring = useSpring({ x, config: timing.config, immediate: timing.immediate });
  return (
    <animated.group position-x={spring.x}>
      <mesh>
        <boxGeometry args={[CELL, CELL, 0.18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.5} />
      </mesh>
      <Label text={label} position={[0, 0, 0.1]} size={0.2} outline={false} />
    </animated.group>
  );
}

/** A divide-and-conquer call as its array: cells glide from their input slots to the returned order. */
function MiniArray({ view, arrays, phase, returned, timing }: { view: StepView; arrays: DcArrays; phase: NodePhase; returned: boolean; timing: AnimTiming }) {
  const input = arrays.input ?? [];
  const sorted = returned && arrays.output && arrays.output.length === input.length ? arrays.output : null;
  const cells = sorted ? sortMoves(input, sorted) : input.map((value, k) => ({ value, from: k, to: k }));
  const xOf = (k: number) => (k - (cells.length - 1) / 2) * PITCH;
  const fmt = (v: V) => previewValue(view.tl, view.snap, v, { depth: 0, maxString: 4 });
  return (
    <group position={[0, 0, 0.06]}>
      {cells.map((c) => (
        <MiniCell key={c.from} x={xOf(sorted ? c.to : c.from)} label={fmt(c.value)} color={PHASE_TINT[phase]}
          glow={phase === 'active' ? 0.9 : phase === 'returned' ? 0.25 : 0.15} timing={timing} />
      ))}
      {returned && !sorted && arrays.output === null && (
        <Label text="returned" position={[0, -0.42, 0]} size={0.16} color={COLORS.inkDim} />
      )}
    </group>
  );
}

function MergePanel({ view, combine, x, width, rows }: {
  view: StepView;
  combine: NonNullable<RecursionBindings['combine']>;
  /** left edge */
  x: number;
  width: number;
  rows: ReturnType<typeof buildArrayModel>[];
}) {
  const timing = useAnimTiming();
  const running = runningCall(view.tl, view.i, combine.fnId);
  const name = view.tl.meta.fns[combine.fnId]?.name ?? 'combine';
  const height = combine.arrays.length * ROW_H;
  useFocusPoint('recursionTree:merge', running !== null ? [x + width / 2, height / 2, 0] : null, 3, `${view.i}`);
  return (
    <group position={[x, 0, 0]}>
      <Label text={running !== null ? `${name}(…) running` : `${name} — idle`} position={[0, height + 0.3, 0]} anchorX="left" size={0.28}
        color={running !== null ? COLORS.current : COLORS.inkFaint} />
      {rows.map((m, r) => {
        const y = (combine.arrays.length - 1 - r) * ROW_H + 0.45;
        const live = running !== null && m.exists;
        return (
          <group key={combine.arrays[r].target.name} position={[0, y, 0]}>
            <Label text={combine.arrays[r].target.name} position={[0, 0, 0]} anchorX="left" size={0.28} color={live ? COLORS.inkDim : COLORS.inkFaint} />
            {m.elems.map((e) => (
              <group key={e.index} position={[1.2 + e.index * PANEL_PITCH, 0, 0]}>
                <mesh>
                  <boxGeometry args={[0.52, 0.52, 0.24]} />
                  <meshStandardMaterial color={live ? e.color : '#1b2433'} emissive={live ? e.color : '#000000'} emissiveIntensity={live && e.pulse ? 0.9 : 0.12} roughness={0.5} />
                </mesh>
                <Label text={e.label} position={[0, 0, 0.13]} size={0.2} color={live ? COLORS.ink : COLORS.inkFaint} outline={false} />
              </group>
            ))}
            {live && m.pointers.map((p) => (
              <PointerMarker key={p.name} x={1.2 + p.index * PANEL_PITCH} y={0.36} label={p.name} color={COLORS.frontier} stack={p.stack} timing={timing} />
            ))}
          </group>
        );
      })}
    </group>
  );
}

export function RecursionTreeView({ view, detection }: VizProps<RecursionBindings>) {
  const b = detection.bindings;
  const { tl } = view;
  const timing = useAnimTiming();
  const hl = useHighlight(view);
  const tree = useMemo(() => buildCallTree(tl, b.fnIds), [tl, b.fnIds]);
  const labels = useMemo(() => {
    const constant = constantArgs(tree);
    return new Map([...tree.nodes.values()].map((n) => [n.callId, shortLabel(tl, tl.snapshots[n.enterStep], n, constant.get(n.fnId))]));
  }, [tl, tree]);
  const arrays = useMemo(() => (b.dc ? new Map([...tree.nodes.values()].map((n) => [n.callId, dcArrays(tl, n)])) : null), [tl, tree, b.dc]);
  const widthOf = useCallback((n: TreeNode) => {
    if (arrays) return Math.max(1, (arrays.get(n.callId)?.input?.length ?? 1) * PITCH + 0.3);
    return Math.max(1, (labels.get(n.callId)?.length ?? 4) * LABEL_SIZE * 0.6 + 0.3);
  }, [arrays, labels]);
  const state = useCallTreeLayout(view, tree, { dy: arrays ? 1.35 : 1.75, gap: 0.35, widthOf });

  const lookOf = useCallback((n: TreeNode, phase: NodePhase): NodeLook => {
    if (arrays) return { ...defaultLook(phase), label: '', radius: 0.06 };
    const done = hasReturned(n, view.i);
    return {
      ...defaultLook(phase),
      label: labels.get(n.callId) ?? '',
      badge: done ? `= ${previewValue(tl, view.snap, n.value, { depth: 0, maxString: 8 })}` : n.threw && phase === 'threw' ? 'threw' : undefined,
    };
  }, [arrays, labels, tl, view.i, view.snap]);
  const extraOf = useCallback((n: TreeNode, phase: NodePhase) => {
    const a = arrays?.get(n.callId);
    return a ? <MiniArray view={view} arrays={a} phase={phase} returned={hasReturned(n, view.i)} timing={timing} /> : null;
  }, [arrays, view, timing]);

  const combine = b.combine;
  const rows = useMemo(() => (combine ? combine.arrays.map((ab) => buildArrayModel(tl, view.i, ab, 'pointers', hl)) : []), [combine, tl, view.i, hl]);
  // the combining helper's panel sits under the tree, so the composition stays roughly square
  const panelW = combine ? 1.2 + Math.max(1, ...rows.map((m) => m.maxLen)) * PANEL_PITCH : 0;
  const panelH = combine ? combine.arrays.length * ROW_H + 0.5 : 0;
  const treeW = Math.max(1, state.layout.width);
  const treeY = combine ? panelH + PANEL_GAP : 0;
  const width = Math.max(treeW, panelW);
  const height = treeY + state.layout.height + 1.5;
  useReportSize({ w: width + 0.6, h: height, d: 1 });

  return (
    <group>
      <Label text={`${detection.title} · ${b.dc ? 'divide & conquer' : 'recursion tree'}`} position={[-width / 2, height - 0.15, 0]} anchorX="left" size={0.32} color={COLORS.inkDim} />
      <CallTreeView view={view} tree={tree} state={state} focusId={detection.key} lookOf={lookOf} extraOf={arrays ? extraOf : undefined}
        offset={[0, treeY, 0]} />
      {combine && <MergePanel view={view} combine={combine} x={-panelW / 2} width={panelW} rows={rows} />}
    </group>
  );
}
