import { useEffect, useState } from "react";

/**
 * Phone width — below Tailwind's `md`, so a JS branch and an `md:` class flip
 * on the same pixel and can't disagree about which layout is on screen.
 *
 * Stated in px rather than rem, unlike every width in the layout: a media
 * query's `rem` is the *initial* root font size and deliberately ignores the
 * one the UI-scale preference writes, so a rem cutoff here would drift out of
 * step with the panels it is meant to describe. The viewport is the one
 * measurement the UI scale doesn't move.
 */
const COMPACT_QUERY = "(max-width: 767px)";

/**
 * Whether the window is too narrow to hold the stage's two halves side by side.
 *
 * This is a fact about the window, never a mode the user chose: the compact
 * layout reads it and degrades — one half instead of two, the sidebar as a
 * drawer instead of a column — without writing anything back to preferences,
 * the same way `useResponsiveDiffViewMode` degrades a split diff. Rotate the
 * phone or widen the window and the desktop layout returns with every stored
 * choice intact.
 */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => query()?.matches ?? false);

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches);
    mq.addEventListener("change", handler);
    // The query can already disagree with the initial state: an orientation
    // change during hydration, or a window resized before the effect ran.
    setCompact(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return compact;
}

/**
 * The media query, or null where there is nothing to ask.
 *
 * jsdom implements no `matchMedia` at all, and this hook is now called from
 * deep inside the code half — so an unguarded call turns "this environment has
 * no viewport" into a crash in every test that mounts a file header. Absent
 * means not compact: the desktop layout is the one that doesn't depend on the
 * answer being right.
 */
function query(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia(COMPACT_QUERY);
}
