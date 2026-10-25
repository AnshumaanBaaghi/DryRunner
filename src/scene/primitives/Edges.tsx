/**
 * Many straight edges in one draw call: screen-space-width lines (LineSegments2) with a color per edge.
 * Every change of the edge list gets a fresh geometry: three caches an instanced geometry's instance
 * count on first draw, so refilling the old one would keep drawing only as many edges as it first had.
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Color } from 'three';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib';

type Vec3 = [number, number, number];

export interface EdgeSpec {
  from: Vec3;
  to: Vec3;
  color: string;
}

const scratch = new Color();

function writeEdges(line: LineSegments2, edges: EdgeSpec[]): void {
  // an empty list still needs one (invisible) segment: the geometry can't be zero-sized
  const n = Math.max(1, edges.length);
  const pos = new Float32Array(n * 6);
  const col = new Float32Array(n * 6);
  edges.forEach((e, k) => {
    pos.set([...e.from, ...e.to], k * 6);
    scratch.set(e.color);
    col.set([scratch.r, scratch.g, scratch.b, scratch.r, scratch.g, scratch.b], k * 6);
  });
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(pos);
  geometry.setColors(col);
  const old = line.geometry;
  line.geometry = geometry;
  old.dispose();
}

function styleMaterial(material: LineMaterial, width: number, w: number, h: number): void {
  material.linewidth = width;
  material.resolution.set(w, h);
}

export function Edges({ edges, width = 2 }: { edges: EdgeSpec[]; width?: number }) {
  const w = useThree((s) => s.size.width);
  const h = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const parts = useMemo(() => {
    const material = new LineMaterial({ vertexColors: true, linewidth: 2 });
    return { material, line: new LineSegments2(new LineSegmentsGeometry(), material) };
  }, []);
  useLayoutEffect(() => {
    writeEdges(parts.line, edges);
    invalidate();
  }, [parts, edges, invalidate]);
  useLayoutEffect(() => styleMaterial(parts.material, width, w, h), [parts, width, w, h]);
  useEffect(() => () => {
    parts.line.geometry.dispose();
    parts.material.dispose();
  }, [parts]);
  return <primitive object={parts.line} />;
}
