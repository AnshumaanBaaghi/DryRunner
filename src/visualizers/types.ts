/**
 * Visualizer plugin contract. Adding a visualizer = one folder exporting a `Visualizer` + one line in
 * registry.ts. `detect` inspects the finished trace (via the shared analysis) and proposes bindings;
 * `Component` renders one detection at the current step inside its layout slot. Plugins export the
 * component lazily (`lazy(() => import('./View'))`) so detection stays importable without WebGL code.
 */
import type { ComponentType, LazyExoticComponent } from 'react';
import type { TraceAnalysis } from '../engine/detect/analysis';
import type { VarRef } from '../engine/detect/track';
import type { Timeline } from '../engine/timeline/types';
import type { VizId } from '../examples/types';
import type { SlotRole, SlotSide } from '../scene/layout';
import type { StepView } from '../state/selectors';

export type { VarRef, VizId };

export interface Detection<B = unknown> {
  /** the plugin's `id` (known ids: `VizId`) */
  vizId: string;
  /** unique per visualized thing (e.g. `array:0:nums`) */
  key: string;
  title: string;
  /** 0..1 confidence */
  score: number;
  role: SlotRole;
  side?: SlotSide;
  mode?: string;
  bindings: B;
  /** variable keys / object keys this detection renders (higher scores claim first) */
  claims: string[];
}

export interface DetectContext {
  tl: Timeline;
  analysis: TraceAnalysis;
}

export interface VizProps<B = unknown> {
  view: StepView;
  detection: Detection<B>;
}

export type VizComponent<B> = ComponentType<VizProps<B>> | LazyExoticComponent<ComponentType<VizProps<B>>>;

export interface Visualizer<B = unknown> {
  id: string;
  label: string;
  detect(ctx: DetectContext): Detection<B>[];
  Component: VizComponent<B>;
  /** extra HUD lines for the current step (e.g. "window expanded: right → 5") */
  describe?(tl: Timeline, i: number, detection: Detection<B>): string[];
  /** default camera elevation when this is the primary view: 0 = level (upright trees, boards), 0.42 = looking down (bars) */
  cameraTilt?: number;
  /**
   * "Show this variable with this view" (role mapping): a detection bound to `ref`, or null when the
   * variable never holds anything this view can draw.
   */
  bindTo?(ctx: DetectContext, ref: VarRef): Detection<B> | null;
}

/** Erased plugin type for the registry (bindings are plugin-private, so the variance is irrelevant there). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyVisualizer = Visualizer<any>;
