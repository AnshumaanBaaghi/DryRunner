/** Emissive "just changed" pulse: spikes when `key` changes while `active`, then decays. */
import { useSpring, type SpringValue } from '@react-spring/three';
import { useEffect, useRef } from 'react';

export function usePulse(key: string, active: boolean, base = 0.08, peak = 2.4): SpringValue<number> {
  const [spring, api] = useSpring(() => ({ v: base }));
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      api.start({ v: base, config: { duration: 250 } });
      return;
    }
    if (last.current === key) return;
    last.current = key;
    api.start({ from: { v: peak }, to: { v: base }, config: { duration: 900 } });
  }, [key, active, base, peak, api]);
  return spring.v;
}
