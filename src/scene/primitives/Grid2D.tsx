/**
 * A rows × cols board of tiles standing in the x-y plane (row 0 on top): chess boards, DP tables, grids.
 * Tiles are one instanced mesh whose colors and raise heights glide toward their targets; labels are
 * text per cell (up to LABEL_LIMIT cells); `marks` put glowing rims on a few cells (current / changed).
 */
import { animated } from '@react-spring/three';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import type { AnimTiming } from '../anim';
import { cellPosition, LABEL_LIMIT, type GridGeometry } from './grid';
import { Label } from './Label';
import { COLORS, SURFACE } from './materials';
import { usePulse } from './pulse';

const DEPTH = 0.16;

export interface GridMark {
  r: number;
  c: number;
  color: string;
  /** a new key replays the pulse */
  pulseKey?: string;
}

export interface Grid2DProps extends GridGeometry {
  colorOf(r: number, c: number): string;
  labelOf?(r: number, c: number): string;
  labelColorOf?(r: number, c: number): string;
  /** how far a tile is raised toward the viewer (0 = flat) */
  raiseOf?(r: number, c: number): number;
  marks?: GridMark[];
  rowHeaders?: string[];
  colHeaders?: string[];
  timing: AnimTiming;
}

interface TileState {
  colors: Color[];
  raise: number[];
}

const dummy = new Object3D();

/** Writes tile matrices/colors, easing `cur` toward `target` (snap: jump). Returns true while still moving. */
function applyTiles(mesh: InstancedMesh, g: GridGeometry, cur: TileState, target: TileState, smoothTime: number, delta: number, snap: boolean): boolean {
  let moving = false;
  const box = { v: 0 };
  for (let k = 0; k < target.colors.length; k++) {
    if (snap) {
      cur.colors[k].copy(target.colors[k]);
      cur.raise[k] = target.raise[k];
    } else {
      moving = easing.dampC(cur.colors[k], target.colors[k], smoothTime, delta) || moving;
      box.v = cur.raise[k];
      moving = easing.damp(box, 'v', target.raise[k], smoothTime, delta) || moving;
      cur.raise[k] = box.v;
    }
    const [x, y] = cellPosition(g, Math.floor(k / g.cols), k % g.cols);
    dummy.position.set(x, y, cur.raise[k] / 2);
    dummy.scale.set(1, 1, 1 + cur.raise[k] / DEPTH);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
    mesh.setColorAt(k, cur.colors[k]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return moving;
}

const AnimatedStandard = animated('meshStandardMaterial');

function Mark({ g, mark }: { g: GridGeometry; mark: GridMark }) {
  const pulse = usePulse(mark.pulseKey ?? '', Boolean(mark.pulseKey), 0.9, 3);
  const [x, y] = cellPosition(g, mark.r, mark.c);
  const size = (g.cell ?? 0.9) + 0.1;
  return (
    <mesh position={[x, y, 0]}>
      <boxGeometry args={[size, size, DEPTH * 0.7]} />
      <AnimatedStandard color={mark.color} emissive={mark.color} emissiveIntensity={pulse} toneMapped={false} />
    </mesh>
  );
}

export function Grid2D(props: Grid2DProps) {
  const { rows, cols, colorOf, labelOf, labelColorOf, raiseOf, marks = [], rowHeaders, colHeaders, timing } = props;
  const cell = props.cell ?? 0.9;
  const gap = props.gap ?? 0.08;
  const g = useMemo<GridGeometry>(() => ({ rows, cols, cell, gap }), [rows, cols, cell, gap]);
  const count = rows * cols;
  const mesh = useRef<InstancedMesh>(null);
  const tiles = useRef<TileState | null>(null);
  /** true once the tiles reached their targets (frames then skip the per-tile work) */
  const settled = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const target = useMemo<TileState>(() => {
    const colors: Color[] = [];
    const raise: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        colors.push(new Color(colorOf(r, c)));
        raise.push(raiseOf?.(r, c) ?? 0);
      }
    }
    return { colors, raise };
  }, [rows, cols, colorOf, raiseOf]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const fresh = !tiles.current || tiles.current.colors.length !== target.colors.length;
    if (fresh) tiles.current = { colors: target.colors.map((c) => c.clone()), raise: [...target.raise] };
    applyTiles(m, g, tiles.current!, target, timing.smoothTime, 0, fresh || timing.immediate);
    settled.current = false;
    invalidate();
  }, [target, g, timing, invalidate]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m || !tiles.current || settled.current) return;
    if (applyTiles(m, g, tiles.current, target, timing.smoothTime, Math.min(delta, 0.1), false)) invalidate();
    else settled.current = true;
  });

  const pitch = cell + gap;
  return (
    <group>
      <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} castShadow receiveShadow>
        <boxGeometry args={[cell, cell, DEPTH]} />
        <meshPhysicalMaterial {...SURFACE} />
      </instancedMesh>
      {marks.map((m) => <Mark key={`${m.r}:${m.c}:${m.color}`} g={g} mark={m} />)}
      {labelOf && count <= LABEL_LIMIT && Array.from({ length: count }, (_, k) => {
        const r = Math.floor(k / cols);
        const c = k % cols;
        const text = labelOf(r, c);
        if (!text) return null;
        const [x, y] = cellPosition(g, r, c);
        return (
          <Label key={k} text={text} position={[x, y, (raiseOf?.(r, c) ?? 0) + DEPTH / 2 + 0.02]} size={cell * 0.34}
            color={labelColorOf?.(r, c) ?? COLORS.ink} maxWidth={cell * 0.95} />
        );
      })}
      {rowHeaders?.map((h, r) => {
        const [x, y] = cellPosition(g, r, 0);
        return <Label key={`r${r}`} text={h} position={[x - pitch * 0.85, y, 0]} size={cell * 0.3} color={COLORS.inkDim} />;
      })}
      {colHeaders?.map((h, c) => {
        const [x, y] = cellPosition(g, 0, c);
        return <Label key={`c${c}`} text={h} position={[x, y + pitch * 0.8, 0]} size={cell * 0.3} color={COLORS.inkDim} />;
      })}
    </group>
  );
}
