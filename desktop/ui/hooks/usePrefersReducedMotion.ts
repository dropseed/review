import { useState, useEffect } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// Hook for reduced motion preference (reactive)
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => query()?.matches ?? false,
  );

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    setPrefersReducedMotion(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

/**
 * The media query, or null where there is nothing to ask — jsdom implements no
 * `matchMedia` at all, and this is now read from inside the compact stage, so
 * an unguarded call turns "this environment has no viewport" into a crash in
 * every test that mounts one. Absent means full motion, which is the answer
 * that renders the layout everything else assumes.
 */
function query(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia(QUERY);
}
