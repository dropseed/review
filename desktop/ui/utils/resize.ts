/**
 * Sizing rules shared by the app's resizable splits.
 *
 * The unit follows what a split divides, not which component happens to own it:
 *
 * - **Side panels** (tab rail, files panel) hold a list of filenames — text that
 *   needs a readable width, not a share of the window. A tree at 25% of an
 *   ultrawide is absurd, and the same 25% on a laptop leaves no diff. So these
 *   are sized absolutely. They're kept in `rem` rather than `px` because the app
 *   scales its entire UI with the code-font preference (`html { font-size:
 *   calc(16px * var(--ui-scale)) }`); a panel measured in px would show fewer
 *   and fewer filenames as the UI grew. rem is the honest unit here — it holds
 *   the *number of readable characters* constant, which is what the panel is
 *   actually sized for.
 * - **Content splits** (diff primary/secondary) divide one region between two
 *   peers of the same kind, so a fraction is the meaningful unit — it survives a
 *   display change with no conversion at all.
 *
 * What gets persisted is the size the user chose; the window clamp is applied at
 * render. Moving to a laptop therefore narrows a panel for as long as you're on
 * it, and plugging the ultrawide back in restores the width you picked there
 * rather than the one the laptop forced on you.
 */

/** Which side of the window a side panel lives on. */
export type SidebarPosition = "left" | "right";

/** Preference keys the two side panels persist their chosen width under. */
export type SidebarWidthKey = "tabRailWidth" | "filesPanelWidth";

export interface SidebarLimits {
  key: SidebarWidthKey;
  /** Fresh-install width, and the width a double-click snaps to. */
  defaultRem: number;
  minRem: number;
  maxRem: number;
}

/**
 * Per-panel sizing, keyed by the side the panel occupies. There is exactly one
 * panel per side, so the side identifies the panel — which is what lets the
 * resize handle find its own preference key without being told.
 */
export const SIDEBAR_LIMITS: Record<SidebarPosition, SidebarLimits> = {
  left: { key: "tabRailWidth", defaultRem: 14, minRem: 10, maxRem: 24 },
  right: {
    key: "filesPanelWidth",
    defaultRem: 19.2,
    minRem: 13.33,
    maxRem: 40,
  },
};

/**
 * Hard ceiling on a side panel as a share of the window. Applied per panel, so
 * with both open the diff still keeps a third of the window. This is what stops
 * a width chosen on a 5K display from eating a laptop screen.
 */
export const SIDEBAR_MAX_VIEWPORT_FRACTION = 1 / 3;

/**
 * Widest a content pane may be dragged, as a fraction of its container. Both
 * ends of a split use it, so neither peer can be dragged out of existence.
 */
export const CONTENT_SPLIT_MIN_FRACTION = 0.2;
export const CONTENT_SPLIT_MAX_FRACTION = 0.8;

/** Largest share of the content region the terminal panel may occupy. */
export const TERMINAL_MAX_CONTENT_FRACTION = 0.75;

/** Round to hundredths so a drag doesn't persist 14 digits of float noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The width to actually render a side panel at: the chosen width, held between
 * the panel's own bounds and whatever the current window can spare.
 *
 * `viewportPx` of 0 (jsdom before layout, a minimized window) means "no window
 * to clamp against" — the chosen width passes through the panel's own bounds
 * rather than collapsing to nothing.
 */
export function clampSidebarWidth(
  chosenRem: number,
  opts: {
    minRem: number;
    maxRem: number;
    viewportPx: number;
    rootFontSizePx: number;
  },
): number {
  const { minRem, maxRem, viewportPx, rootFontSizePx } = opts;
  const fontSize = rootFontSizePx > 0 ? rootFontSizePx : 16;
  const width = Number.isFinite(chosenRem) ? chosenRem : minRem;
  const viewportMaxRem =
    viewportPx > 0
      ? (viewportPx * SIDEBAR_MAX_VIEWPORT_FRACTION) / fontSize
      : Number.POSITIVE_INFINITY;
  // The floor outranks the window cap: below minRem it isn't a panel any more,
  // and a window that narrow has worse problems than a wide sidebar.
  const upper = Math.max(minRem, Math.min(maxRem, viewportMaxRem));
  return round2(Math.min(Math.max(width, minRem), upper));
}

/** Hold a split fraction inside its bounds, defaulting to the content-split ones. */
export function clampFraction(
  fraction: number,
  min: number = CONTENT_SPLIT_MIN_FRACTION,
  max: number = CONTENT_SPLIT_MAX_FRACTION,
): number {
  if (!Number.isFinite(fraction)) return (min + max) / 2;
  return Math.min(Math.max(fraction, min), max);
}

/**
 * The width to actually render a px-sized panel at inside a container: the
 * chosen width, capped at `maxFraction` of the container.
 *
 * The chosen width is left alone — only what's rendered shrinks — so the panel
 * comes back at full size on the display it was sized for. `containerPx` of 0
 * means the container hasn't been measured yet; nothing to clamp against.
 */
export function clampPanelWidthPx(
  chosenPx: number,
  containerPx: number,
  maxFraction: number,
): number {
  if (!Number.isFinite(chosenPx)) return 0;
  if (containerPx <= 0) return chosenPx;
  return Math.min(chosenPx, containerPx * maxFraction);
}

/**
 * The double-click rule every resize handle shares: snap to the canonical size,
 * and snap back on the next double-click.
 *
 * Reversibility is the point. A double-click that only ever collapses a panel is
 * a trap — you can't undo it with the gesture that caused it — so the size the
 * handle was at before the snap is handed back for the caller to remember, and
 * the next double-click restores it.
 *
 * `fallback` covers the first double-click when already at the canonical size
 * and nothing has been remembered yet, so the gesture always visibly does
 * something. Passing `canonical` as the fallback makes that case a no-op
 * instead, which is what a split with nowhere else to go wants.
 */
export function toggleToCanonical(
  current: number,
  canonical: number,
  remembered: number | null,
  fallback: number,
  epsilon: number,
): { next: number; remember: number | null } {
  if (Math.abs(current - canonical) <= epsilon) {
    return { next: remembered ?? fallback, remember: null };
  }
  return { next: canonical, remember: current };
}

/**
 * Coalesce a high-frequency callback (pointer moves) into at most one call per
 * animation frame, keeping only the newest arguments and dropping the rest.
 *
 * Pointer devices report far faster than the screen repaints — a 1000Hz mouse
 * can fire a dozen `mousemove`s between two frames — and every one of those was
 * driving a synchronous store write and a full re-render of the panel being
 * resized. Only the last one per frame can ever be seen, so the others are pure
 * cost.
 */
export function rafThrottle<T extends unknown[]>(
  fn: (...args: T) => void,
): ((...args: T) => void) & { cancel: () => void } {
  let frame: number | null = null;
  let latest: T | null = null;

  const run = (): void => {
    frame = null;
    const args = latest;
    latest = null;
    if (args) fn(...args);
  };

  const throttled = (...args: T): void => {
    latest = args;
    if (frame === null) frame = requestAnimationFrame(run);
  };

  throttled.cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    latest = null;
  };

  return throttled;
}

/** The px value of one rem, as the document currently renders it. */
export function rootFontSize(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}
