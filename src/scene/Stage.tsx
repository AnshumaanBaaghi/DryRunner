/**
 * The 3D stage: canvas, lights, studio environment, floor, post-processing and the camera rig around
 * the active visualizers — each in its own layout slot, error boundary and suspense boundary.
 * Renders on demand: springs, controls and text invalidate the frame loop only while something moves.
 */
import { ContactShadows, Environment, Grid, Lightformer } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, type ComponentType } from 'react';
import { useStepView } from '../state/selectors';
import { useViz } from '../state/vizStore';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { visualizerById } from '../visualizers/registry';
import type { Detection, VizProps } from '../visualizers/types';
import { configureText } from './assets';
import { DEFAULT_DIR } from './camera';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import type { SlotSpec } from './layout';
import { LayoutRoot } from './LayoutRoot';
import { Label } from './primitives/Label';
import { COLORS } from './primitives/materials';

const FLOOR_Y = -1.1;

/** On-demand rendering: request a frame whenever this subtree commits (e.g. a lazy plugin resolved). */
function Invalidate() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  });
  return null;
}

/**
 * Studio reflections from soft light panels: front and side panels give the glossy blocks a sheen while
 * nothing sits overhead, so the top faces of bars keep their semantic color instead of mirroring a lamp.
 */
function StudioEnvironment() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.7}>
      <Lightformer intensity={1.1} position={[0, 3, 12]} scale={[16, 5, 1]} target={[0, 0, 0]} />
      <Lightformer intensity={1.5} color="#9db8ff" position={[-12, 2, 2]} scale={[14, 2.5, 1]} target={[0, 0, 0]} />
      <Lightformer intensity={1.3} color="#c4a7ff" position={[12, 2, 2]} scale={[14, 2.5, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={0.3} position={[0, 1, -14]} scale={7} target={[0, 0, 0]} />
    </Environment>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 14, 10]} intensity={1.15} />
      <directionalLight position={[-10, 6, 4]} intensity={0.45} color="#9db8ff" />
      <directionalLight position={[0, 8, -14]} intensity={0.8} color="#c4a7ff" />
      <StudioEnvironment />
      <Invalidate />
    </>
  );
}

function Floor({ high }: { high: boolean }) {
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <Grid
        args={[80, 80]}
        infiniteGrid
        fadeDistance={48}
        fadeStrength={2.2}
        cellSize={0.54}
        cellThickness={0.55}
        cellColor="#152033"
        sectionSize={2.16}
        sectionThickness={0.9}
        sectionColor="#22324c"
      />
      {high && <ContactShadows position={[0, 0.01, 0]} scale={70} far={5} blur={2.4} opacity={0.6} resolution={512} />}
    </group>
  );
}

function PluginError({ detection }: { detection: Detection }) {
  return <Label text={`${detection.title}: this view failed to render`} position={[0, 0.6, 0]} size={0.3} color={COLORS.error} />;
}

function Scene() {
  const view = useStepView();
  const active = useViz((s) => s.active);
  const timeline = useViz((s) => s.timeline);
  const specs = useMemo<SlotSpec[]>(() => active.map((d, order) => ({ id: d.key, role: d.role, side: d.side, order })), [active]);
  const byKey = useMemo(() => new Map(active.map((d) => [d.key, d])), [active]);
  if (!view || view.tl !== timeline || !active.length) return null;
  return (
    <LayoutRoot specs={specs}>
      {(spec) => {
        const d = byKey.get(spec.id);
        const plugin = d && visualizerById(d.vizId);
        if (!d || !plugin) return null;
        const View = plugin.Component as ComponentType<VizProps<unknown>>;
        return (
          <ErrorBoundary resetKey={timeline} fallback={<PluginError detection={d} />}>
            <Suspense fallback={null}>
              <View view={view} detection={d} />
              <Invalidate />
            </Suspense>
          </ErrorBoundary>
        );
      }}
    </LayoutRoot>
  );
}

export default function Stage({ onContextLost }: { onContextLost?: () => void }) {
  const quality = useViz((s) => s.quality);
  const high = quality === 'high';
  configureText();
  return (
    <Canvas
      key={quality}
      frameloop="demand"
      dpr={high ? [1, 2] : 1}
      gl={{ antialias: !high, powerPreference: 'high-performance' }}
      camera={{ position: DEFAULT_DIR.map((v) => v * 14) as [number, number, number], fov: 40, near: 0.1, far: 300 }}
      onCreated={(state) => {
        const { gl } = state;
        // dev-only handle for end-to-end tests (inspecting the rendered scene); absent from production builds
        if (import.meta.env.DEV) (window as unknown as { __algoscopeThree?: unknown }).__algoscopeThree = state;
        const canvas = gl.domElement;
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          // disposing a canvas (unmount, quality switch) also drops its context: only a live canvas counts
          if (canvas.isConnected) onContextLost?.();
        });
      }}
    >
      <color attach="background" args={[COLORS.bg]} />
      <fog attach="fog" args={[COLORS.bg, 32, 110]} />
      <Lights />
      <Floor high={high} />
      <Scene />
      <CameraRig />
      {high && <Effects />}
    </Canvas>
  );
}
