// The slim track beside the code view: one marker per hunk (or per changed
// line run in the old/new view modes), colored by review status and positioned
// by line fraction over the file's line count, plus a band that tracks the
// viewport. It REPLACES the native scrollbar while it is up — pressing or
// dragging the track scrubs the file, clicking a marker jumps to its hunk.
// Marker positions are line-fraction approximations (annotation panels and
// wrapped lines add height the fractions don't see), which is fine for an
// orientation aid.

import { memo, useCallback, useEffect, useRef } from "react";
import type { ReviewState } from "../../types";
import { isHunkTrusted } from "../../types";
import { usePrefersReducedMotion } from "../../hooks";
import { useSpurStore } from "../../stores";
import { cancelCodeViewScroll } from "./FileCodeView";

/** A marker renders no shorter than this, and its click target matches. */
const MARKER_MIN_PX = 3;
/** Pointer jitter below this is a click, not a drag. */
const DRAG_SLOP_PX = 3;

// --- Public types ---

export type MarkerStatus =
  | "pending"
  | "trusted"
  | "approved"
  | "rejected"
  | "saved_for_later"
  | "classifying"
  | "added"
  | "deleted";

export interface MinimapMarker {
  id: string;
  topFraction: number;
  heightFraction: number;
  status: MarkerStatus;
  scrollLine?: number;
  hasAnnotations?: boolean;
}

interface DiffMinimapProps {
  markers: MinimapMarker[];
  scrollContainer: HTMLElement | null;
  onMarkerClick: (index: number) => void;
}

interface DragState {
  rect: DOMRect;
  grabOffset: number;
  startY: number;
  scrubbing: boolean;
}

// --- Helpers ---

export function getMarkerStatus(
  hunkId: string,
  reviewState: ReviewState | null,
  trustList: string[],
): MarkerStatus {
  const hunkState = reviewState?.hunks[hunkId];
  if (!hunkState) return "pending";

  switch (hunkState.status?.value) {
    case "approved":
    case "rejected":
    case "saved_for_later":
      return hunkState.status.value;
    default:
      return isHunkTrusted(hunkState, trustList) ? "trusted" : "pending";
  }
}

/**
 * Where the viewport band sits in the track, as 0..1 fractions of its height —
 * the single geometry the drawn band and the pointer hit-test share, so a
 * press lands on exactly what the user sees.
 */
function bandFractions(el: HTMLElement): { top: number; height: number } {
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= 0) return { top: 0, height: 1 };
  return {
    top: scrollTop / scrollHeight,
    height: Math.min(clientHeight / scrollHeight, 1),
  };
}

// Semantic status colors
const STATUS_COLORS: Record<MarkerStatus, string> = {
  pending: "bg-status-pending",
  trusted: "bg-status-trusted",
  approved: "bg-status-approved",
  rejected: "bg-status-rejected",
  saved_for_later: "bg-status-saved",
  classifying: "bg-guide",
  added: "bg-status-added",
  deleted: "bg-status-deleted",
};

// --- Component ---

export const DiffMinimap = memo(function DiffMinimap({
  markers,
  scrollContainer,
  onMarkerClick,
}: DiffMinimapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rafId = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Subscribe to focused hunk ID directly.
  const focusedHunkId = useSpurStore((s) => s.focusedHunkId);

  // Self-manage scroll tracking
  useEffect(() => {
    if (!scrollContainer) return;

    const update = () => {
      const el = viewportRef.current;
      if (!el) return;
      const band = bandFractions(scrollContainer);
      el.style.top = `${band.top * 100}%`;
      el.style.height = `${band.height * 100}%`;
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(update);
    };

    update();

    scrollContainer.addEventListener("scroll", scheduleUpdate, {
      passive: true,
    });

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scrollContainer);

    return () => {
      cancelAnimationFrame(rafId.current);
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      observer.disconnect();
    };
  }, [scrollContainer]);

  // All pointer handling lives on the track — the markers and band are
  // pointer-events-none so they can never block scrubbing (a big hunk's marker
  // can cover most of the strip, which is exactly when the scrollbar
  // replacement must still scrub). A press-and-drag scrubs; a still press is a
  // click: on a marker it jumps to that hunk, elsewhere it jumps the view to
  // that point of the track. Scrubbing moves the band as a grabbed thumb —
  // relative to where it was pressed when inside it, centered on the pointer
  // when not — mapped through the same scrollTop/scrollHeight space the band is
  // DRAWN in, so it tracks the pointer exactly instead of sliding out from
  // under it. The track rect is measured once per drag (it can't move
  // mid-drag); the scroll heights are read live each move because the
  // virtualizer refines them as new regions render.
  const dragRef = useRef<DragState | null>(null);

  const scrubTo = useCallback(
    (drag: DragState, clientY: number) => {
      if (!scrollContainer || drag.rect.height === 0) return;
      const bandTop = clientY - drag.grabOffset - drag.rect.top;
      scrollContainer.scrollTop =
        (bandTop / drag.rect.height) * scrollContainer.scrollHeight;
    },
    [scrollContainer],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Primary button only — a right-click reaching for the context menu
      // must not capture the pointer, cancel a scroll, or jump the view.
      if (!scrollContainer || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      cancelCodeViewScroll(scrollContainer);
      const rect = e.currentTarget.getBoundingClientRect();
      const band = bandFractions(scrollContainer);
      const bandTop = rect.top + band.top * rect.height;
      const bandHeight = band.height * rect.height;
      const inBand = e.clientY >= bandTop && e.clientY <= bandTop + bandHeight;
      dragRef.current = {
        rect,
        grabOffset: inBand ? e.clientY - bandTop : bandHeight / 2,
        startY: e.clientY,
        scrubbing: false,
      };
    },
    [scrollContainer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      // A couple of pixels of jitter is still a click, not a drag.
      if (!drag.scrubbing && Math.abs(e.clientY - drag.startY) < DRAG_SLOP_PX)
        return;
      drag.scrubbing = true;
      scrubTo(drag, e.clientY);
    },
    [scrubTo],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.scrubbing || drag.rect.height === 0) return;
      // A still press: a marker click if one sits under the pointer (using the
      // same floor the markers render with), else a jump to that point of the
      // track.
      const fraction = (e.clientY - drag.rect.top) / drag.rect.height;
      const minHeight = MARKER_MIN_PX / drag.rect.height;
      const hit = markers.findIndex(
        (m) =>
          fraction >= m.topFraction &&
          fraction <= m.topFraction + Math.max(m.heightFraction, minHeight),
      );
      if (hit !== -1) {
        onMarkerClick(hit);
      } else {
        scrubTo(drag, e.clientY);
      }
    },
    [markers, onMarkerClick, scrubTo],
  );

  return (
    <div
      className={`relative w-3 shrink-0 group touch-none overflow-hidden border-l border-edge/50${
        scrollContainer ? " cursor-pointer" : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => (dragRef.current = null)}
      aria-hidden="true"
    >
      {/* Track background - subtle on hover */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface-panel/0 via-surface-raised/20 to-surface-panel/0 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Viewport indicator */}
      <div
        ref={viewportRef}
        className="absolute left-0 right-0 bg-fg-muted/15 border-y border-fg-muted/25 pointer-events-none transition-colors group-hover:bg-fg-muted/25 group-hover:border-fg-muted/40"
        style={{ top: "0%", height: "100%" }}
      />

      {/* Hunk markers — hit-tested on pointerup, never clicked directly */}
      {markers.map((marker) => {
        const colorClass = STATUS_COLORS[marker.status];
        const pulseClass =
          marker.status === "classifying" && !prefersReducedMotion
            ? " animate-pulse"
            : "";
        const focusRing =
          marker.id === focusedHunkId
            ? " ring-1 ring-status-modified/80 ring-offset-1 ring-offset-surface-panel"
            : "";

        return (
          <div
            key={marker.id}
            className={`pointer-events-none absolute left-0.5 right-0.5 rounded-[2px] transition-[left,right] group-hover:left-0 group-hover:right-0 ${colorClass}${pulseClass}${focusRing}`}
            style={{
              top: `${marker.topFraction * 100}%`,
              height: `${marker.heightFraction * 100}%`,
              minHeight: `${MARKER_MIN_PX}px`,
            }}
          >
            {marker.hasAnnotations && (
              <div className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-status-modified ring-1 ring-surface-panel" />
            )}
          </div>
        );
      })}
    </div>
  );
});
