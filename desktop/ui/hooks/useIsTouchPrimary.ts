import { useEffect, useState } from "react";

/**
 * A device driven by fingers rather than a pointer: coarse pointer, no hover.
 *
 * Both halves matter. `pointer: coarse` alone is true of a touchscreen laptop,
 * which has a real keyboard and a mouse and wants none of what this gates;
 * `hover: none` is what says the finger is the *only* input.
 */
const TOUCH_QUERY = "(pointer: coarse) and (hover: none)";

/**
 * Whether this device's only input is touch.
 *
 * A different question from `useIsCompact`, deliberately — that one is about
 * the window's width, and answers layout ("one half instead of two", "a drawer
 * instead of a column"). This one is about what the person is holding, and
 * answers input: a software keyboard sends characters and nothing else, so the
 * terminal's Esc, Tab and arrows have to come from somewhere. An iPad in
 * landscape is wide and still has no Escape key, which is the case a width
 * test gets wrong.
 */
export function useIsTouchPrimary(): boolean {
  const [touch, setTouch] = useState(() => query()?.matches ?? false);

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener("change", handler);
    setTouch(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return touch;
}

/** The query, or null where there is nothing to ask (jsdom has no matchMedia). */
function query(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia(TOUCH_QUERY);
}
