import { useState, useEffect, useRef } from "react";

/**
 * Hook that animates a number from its current value to a target value
 * using an ease-out cubic curve.
 */
export function useAnimatedCount(target: number, duration = 400): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number>();

  useEffect(() => {
    const from = display;
    if (from === target) return;

    const start = performance.now();

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (target - from) * eased);
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  return display;
}
