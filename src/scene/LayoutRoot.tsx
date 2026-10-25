/** Renders each active visualizer in its slot; slots glide to new positions when the layout changes. */
import { animated, useSpring } from '@react-spring/three';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeLayout, SlotContext, useLayoutStore, type SlotSpec, type Vec3 } from './layout';

export function LayoutRoot({ specs, children }: { specs: SlotSpec[]; children: (spec: SlotSpec) => ReactNode }) {
  const sizes = useLayoutStore((s) => s.sizes);
  const layout = useMemo(() => computeLayout(specs, sizes), [specs, sizes]);
  const complete = specs.length > 0 && specs.every((s) => s.id in sizes);
  useEffect(() => useLayoutStore.getState().setBounds(layout.bounds, complete), [layout.bounds, complete]);
  return (
    <>
      {specs.map((spec) => (
        <Slot key={spec.id} id={spec.id} position={layout.positions[spec.id] ?? [0, 0, 0]}>
          {children(spec)}
        </Slot>
      ))}
    </>
  );
}

function Slot({ id, position, children }: { id: string; position: Vec3; children: ReactNode }) {
  const [first] = useState(position);
  const spring = useSpring({ from: { p: first }, to: { p: position }, config: { tension: 120, friction: 22 } });
  const ctx = useMemo(() => ({ id, origin: position }), [id, position]);
  return (
    <animated.group position={spring.p as unknown as Vec3}>
      <SlotContext.Provider value={ctx}>{children}</SlotContext.Provider>
    </animated.group>
  );
}
