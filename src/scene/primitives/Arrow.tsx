/** Curved tube with an optional cone head (edges, pointers, dependency beams, compare / swap arcs). */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

type Vec3 = [number, number, number];

export function Arrow({ from, to, color, radius = 0.045, bend = 0.6, head = true, headSize = 0.2, opacity = 1, glow = 0.6 }: {
  from: Vec3;
  to: Vec3;
  color: string;
  radius?: number;
  /** arc height relative to the distance (0 = straight) */
  bend?: number;
  /** false: a plain arc, e.g. joining two compared elements */
  head?: boolean;
  headSize?: number;
  opacity?: number;
  glow?: number;
}) {
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  const shape = useMemo(() => {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const dist = a.distanceTo(b);
    if (dist < 1e-3) return null;
    const mid = a.clone().lerp(b, 0.5);
    mid.y += dist * bend * 0.35;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const end = head ? curve.getPoint(Math.max(0, 1 - headSize / dist)) : b;
    const geometry = new THREE.TubeGeometry(head ? new THREE.QuadraticBezierCurve3(a, mid, end) : curve, 24, radius, 8, false);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(end).normalize());
    return { geometry, tip: end.clone().lerp(b, 0.5), quaternion };
  }, [ax, ay, az, bx, by, bz, radius, bend, head, headSize]);
  // a replaced curve frees its GPU buffers (unmounting is handled by the renderer)
  useEffect(() => () => shape?.geometry.dispose(), [shape]);
  if (!shape) return null;
  const transparent = opacity < 1;
  return (
    <group>
      <mesh geometry={shape.geometry}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} transparent={transparent} opacity={opacity} toneMapped={false} />
      </mesh>
      {head && (
        <mesh position={shape.tip} quaternion={shape.quaternion}>
          <coneGeometry args={[radius * 3, headSize, 14]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} transparent={transparent} opacity={opacity} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
