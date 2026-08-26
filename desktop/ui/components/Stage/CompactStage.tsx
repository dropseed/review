import { type ReactNode, useEffect, useRef } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { lockAxis } from "../Terminal/touch-gestures";
import { TerminalPanel } from "../Terminal/TerminalPanel";
import {
  AXIS_SLOP_PX,
  codePushed,
  dragProgress,
  popCommits,
  pushTransforms,
  startsAtEdge,
} from "./push-nav";

/**
 * The phone's stage: the terminal, with the code half pushed over it.
 *
 * Not two tabs. A phone opens this app because something is running in a
 * terminal — that is the screen, and it is where every launch lands. The code
 * half is somewhere you *go*, from the `</>` in the terminal's own strip, and
 * it arrives the way a pushed screen arrives on iOS: in from the right, over a
 * terminal that slides a little the other way and dims, with "‹ Terminal" in
 * the top-left of what covered it and a swipe from the left edge to send it
 * back. A bottom tab bar said the two were peers, and spent 60pt of an 844pt
 * screen saying it about a switch nobody makes twice an hour.
 *
 * Both halves stay mounted throughout, for the reason the dock's compact branch
 * already kept them: the terminal under here is streaming, and unmounting an
 * xterm to look at a diff would throw its screen away.
 *
 * `contentFocus` is still the one state underneath — see `push-nav`'s
 * `codePushed`. Nothing here is a mode of its own, so widening the window puts
 * the two halves side by side exactly as they were.
 */
export function CompactStage({
  docked,
  children,
}: {
  /** Whether this workspace has a terminal half at all. */
  docked: boolean;
  /** The code half. */
  children: ReactNode;
}): ReactNode {
  const contentFocus = useReviewStore((s) => s.contentFocus);
  const setContentFocus = useReviewStore((s) => s.setContentFocus);
  const reduced = usePrefersReducedMotion();
  const pushed = codePushed(contentFocus, docked);

  const screenRef = useRef<HTMLDivElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  // Which screen the stack is on, for the native listeners below — they are
  // bound once and must not be re-bound on every store update just to read it.
  const pushedRef = useRef(pushed);
  pushedRef.current = pushed;

  // The back-swipe. Native listeners rather than React's, and for one reason:
  // React attaches `touchstart`/`touchmove` passively at the root, so a
  // synthetic handler cannot `preventDefault` — which is what stops the list
  // underneath scrolling sideways, and what stops iOS reading the same drag as
  // its own back gesture.
  //
  // Under reduced motion nothing follows the finger: the swipe still pops, it
  // just doesn't animate its way there.
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen || !docked) return;

    /** Draw the stack at `progress` — 0 fully pushed, 1 fully popped. */
    const paint = (progress: number): void => {
      const at = pushTransforms(progress);
      const underlay = underlayRef.current;
      const scrim = scrimRef.current;
      screen.style.transform = at.screen;
      if (underlay) underlay.style.transform = at.underlay;
      if (scrim) scrim.style.opacity = String(at.scrim);
    };

    /**
     * Hand the transition back to CSS, or take it away for the length of a
     * drag — off while the finger is down, so the screen tracks it exactly
     * instead of chasing it 350ms behind, and back on the moment it lets go.
     *
     * Written once at each end of the gesture rather than on every move: the
     * value is the same all the way through, and a style write per touchmove
     * is a style write per frame.
     */
    const setTransitions = (on: boolean): void => {
      for (const el of [screen, underlayRef.current, scrimRef.current]) {
        if (el) el.style.transition = on ? "" : "none";
      }
    };

    let tracking = false;
    let horizontal = false;
    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let width = 0;

    const onStart = (e: TouchEvent): void => {
      if (!pushedRef.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      // The screen is `inset-0` over the whole stage, so its left edge is the
      // viewport's — which is what lets the cheap test come *before* the
      // layout read rather than after it, on every touch that isn't this
      // gesture.
      if (!startsAtEdge(touch.clientX)) return;
      const rect = screen.getBoundingClientRect();
      tracking = true;
      horizontal = false;
      startX = touch.clientX;
      startY = touch.clientY;
      startedAt = e.timeStamp;
      width = rect.width;
    };

    const onMove = (e: TouchEvent): void => {
      if (!tracking) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!horizontal) {
        const axis = lockAxis(dx, dy, AXIS_SLOP_PX);
        if (axis === null) return;
        // A vertical drag from the edge is the file list being scrolled, and a
        // leftward one is not a back-swipe. Either way this gesture is over —
        // decided once, so it cannot flip axis by wobbling afterwards.
        if (axis === "vertical" || dx <= 0) {
          tracking = false;
          return;
        }
        horizontal = true;
        if (!reduced) setTransitions(false);
      }

      // The drag is ours from here.
      e.preventDefault();
      if (!reduced) paint(dragProgress(dx, width));
    };

    const onEnd = (e: TouchEvent): void => {
      if (!tracking) return;
      tracking = false;
      if (!horizontal) return;
      const touch = e.changedTouches[0];
      const dx = touch ? touch.clientX - startX : 0;
      const commit = popCommits({ dx, dt: e.timeStamp - startedAt, width });
      // Paint where this is going *before* telling the store, so the render
      // that follows sets the values already on the element. Both orders
      // animate; only this one can't flash the screen home for a frame first.
      if (!reduced) {
        setTransitions(true);
        paint(commit ? 1 : 0);
      }
      if (commit) setContentFocus("split");
    };

    const onCancel = (): void => {
      if (tracking && horizontal && !reduced) {
        setTransitions(true);
        paint(0);
      }
      tracking = false;
    };

    screen.addEventListener("touchstart", onStart, { passive: true });
    screen.addEventListener("touchmove", onMove, { passive: false });
    screen.addEventListener("touchend", onEnd);
    screen.addEventListener("touchcancel", onCancel);
    return () => {
      screen.removeEventListener("touchstart", onStart);
      screen.removeEventListener("touchmove", onMove);
      screen.removeEventListener("touchend", onEnd);
      screen.removeEventListener("touchcancel", onCancel);
    };
  }, [docked, reduced, setContentFocus]);

  // With no terminal half there is nothing to push over: the code half is the
  // screen, drawn flat, with no back affordance pointing at what isn't there.
  if (!docked) {
    return (
      <div className="relative flex flex-1 flex-col overflow-hidden bg-surface">
        {children}
      </div>
    );
  }

  const rest = pushTransforms(pushed ? 0 : 1);

  return (
    <div className="relative flex flex-1 overflow-hidden bg-surface">
      {/* The screen underneath. It keeps its layout while covered — this is a
          stack, not a swap — so the terminal goes on streaming and comes back
          scrolled exactly where it was. */}
      <div
        ref={underlayRef}
        className={clsx(
          "absolute inset-0 overflow-hidden p-2",
          !reduced && "nav-push",
        )}
        style={reduced ? undefined : { transform: rest.underlay }}
      >
        <TerminalPanel />
      </div>

      {/* Depth, not decoration: without it the covered screen reads as a second
          live surface beside the first rather than one behind it. Inert — the
          ways back are the nav bar's own button and the edge swipe. */}
      <div
        ref={scrimRef}
        aria-hidden="true"
        className={clsx(
          "pointer-events-none absolute inset-0 bg-black",
          !reduced && "nav-push-scrim",
        )}
        style={{ opacity: reduced ? 0 : rest.scrim }}
      />

      {/* The pushed screen. Opaque, because it slides over something. */}
      <div
        ref={screenRef}
        className={clsx(
          "absolute inset-0 z-10 flex flex-col overflow-hidden bg-surface",
          reduced
            ? clsx("nav-crossfade", !pushed && "pointer-events-none opacity-0")
            : "nav-push",
        )}
        style={reduced ? undefined : { transform: rest.screen }}
        // Off-screen but laid out: without this its buttons stay in the tab
        // order, and focusing one would scroll a clipped container sideways.
        inert={!pushed}
      >
        {children}
      </div>
    </div>
  );
}
