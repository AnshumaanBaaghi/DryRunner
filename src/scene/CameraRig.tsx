/**
 * Orbit camera with damping. A new scene and "reset view" frame every visualizer below the HUD; with
 * follow on, the camera re-frames as the layout changes and — when the whole scene would make labels
 * unreadably small — glides to the step's focus point. Any manual orbit/zoom pauses following for 4 s.
 */
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import { useEffect, useRef, type ComponentRef } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import { useViz } from '../state/vizStore';
import { DEFAULT_DIR, fitDistance } from './camera';
import { currentFocus, useFocusStore } from './focus';
import { useLayoutStore } from './layout';

type Controls = ComponentRef<typeof OrbitControls>;

const PAUSE_MS = 4000;
/** world-units-per-pixel budget: beyond this distance 0.26-unit labels drop under ~9 px, so follow zooms in */
const READABLE = 0.04;
const SMOOTH = 0.35;

interface Goal {
  target: Vector3;
  dist: number;
  dir: Vector3;
  snap: boolean;
}

export function CameraRig() {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const bounds = useLayoutStore((s) => s.bounds);
  const complete = useLayoutStore((s) => s.complete);
  const focus = useFocusStore((s) => currentFocus(s.points));
  const follow = useViz((s) => s.follow);
  const active = useViz((s) => s.active);
  const viewNonce = useViz((s) => s.viewNonce);
  const hudInset = useViz((s) => s.hudInset);
  const goal = useRef<Goal | null>(null);
  const pausedUntil = useRef(0);
  const fitUntil = useRef(0);
  /** the first framing snaps; later ones glide */
  const framed = useRef(false);
  /** "reset view" also restores the default viewing angle */
  const resetAngle = useRef(true);

  // a new set of visualizers: frame them (sizes arrive over the next frames, so keep re-fitting briefly)
  useEffect(() => {
    fitUntil.current = performance.now() + 1200;
  }, [active]);

  useEffect(() => {
    pausedUntil.current = 0;
    fitUntil.current = performance.now() + 600;
    resetAngle.current = true;
  }, [viewNonce]);

  useEffect(() => {
    const c = controls.current;
    // frame only real sizes: placeholder bounds would zoom in and back out
    if (!c || !complete) return;
    const now = performance.now();
    const fitting = now < fitUntil.current;
    if (!fitting && (!follow || now < pausedUntil.current)) return;
    const min = new Vector3(...bounds.min);
    const max = new Vector3(...bounds.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const extent = max.clone().sub(min);
    // keep the scene inside the band between the HUD (top) and the stage controls (bottom)
    const top = Math.min(0.45, (hudInset + 8) / Math.max(1, height));
    const bottom = Math.min(0.2, 48 / Math.max(1, height));
    const band = Math.max(0.35, 1 - top - bottom);
    const fit = Math.max(6, fitDistance([extent.x + 2.5, (extent.y + 1.2) / band, extent.z], camera.fov, width / Math.max(1, height)) * 1.12);
    const comfort = Math.max(12, READABLE * height);
    let target = center;
    let dist = fit;
    if (!fitting && fit > comfort * 1.15 && focus) {
      target = new Vector3(...focus).clamp(min, max);
      target.y = Math.max(target.y, center.y * 0.6);
      dist = comfort;
    }
    const viewHeight = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
    target = target.clone();
    target.y -= ((bottom + 1 - top) / 2 - 0.5) * viewHeight;
    const dir = resetAngle.current
      ? new Vector3(...DEFAULT_DIR).normalize()
      : camera.position.clone().sub(c.target).normalize();
    goal.current = { target, dist, dir, snap: !framed.current };
    framed.current = true;
    resetAngle.current = false;
    invalidate();
  }, [bounds, complete, focus, follow, viewNonce, hudInset, width, height, camera, invalidate]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      pausedUntil.current = Number.POSITIVE_INFINITY;
      fitUntil.current = 0;
      goal.current = null;
    };
    const onEnd = () => {
      pausedUntil.current = performance.now() + PAUSE_MS;
    };
    c.addEventListener('start', onStart);
    c.addEventListener('end', onEnd);
    return () => {
      c.removeEventListener('start', onStart);
      c.removeEventListener('end', onEnd);
    };
  }, []);

  useFrame((_, delta) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const pos = g.target.clone().addScaledVector(g.dir, g.dist);
    if (g.snap) {
      c.target.copy(g.target);
      camera.position.copy(pos);
    } else {
      const dt = Math.min(delta, 0.1);
      easing.damp3(c.target, g.target, SMOOTH, dt);
      easing.damp3(camera.position, pos, SMOOTH, dt);
    }
    c.update();
    if (c.target.distanceTo(g.target) < 0.002 && camera.position.distanceTo(pos) < 0.002) goal.current = null;
    else invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      rotateSpeed={0.7}
      zoomSpeed={0.85}
      minDistance={2.5}
      maxDistance={120}
      maxPolarAngle={Math.PI * 0.495}
    />
  );
}
