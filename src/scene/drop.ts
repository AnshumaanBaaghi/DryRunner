/** Drop-in motion for things that appear (pushed, created, stored): they fall from `height` above into place. */
import { useSpring, type SpringValue } from '@react-spring/three';
import { useEffect, useRef } from 'react';
import type { AnimTiming } from './anim';

/** Replays the drop whenever `active` turns on for a new step key; returns the y offset to apply. */
export function useDrop(key: string, active: boolean, timing: AnimTiming, height = 0.9): SpringValue<number> {
  // mounted while dropping: start up high, so the first frame is not drawn in place
  const [spring, api] = useSpring(() => ({ y: active && !timing.immediate ? height : 0 }));
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!active || last.current === key) return;
    last.current = key;
    if (timing.immediate) api.start({ y: 0, immediate: true });
    else api.start({ from: { y: height }, to: { y: 0 }, config: timing.config });
  }, [key, active, api, timing, height]);
  return spring.y;
}
