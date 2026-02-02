import { useCallback, useEffect, useRef } from "react";
import type { ReviewState } from "../../types";
import { isHunkTrusted } from "../../types";
import { usePrefersReducedMotion } from "../../hooks";

// --- Public types ---

export type HunkStatus =
  | "pending"
  | "trusted"
  | "approved"
  | "rejected"
  | "classifying";

export interface MinimapMarker {
  id: string;
  topFraction: number;
  heightFraction: number;
  status: HunkStatus;
  isFocused: boolean;
}

interface DiffMinimapProps {
  markers: MinimapMarker[];
  scrollContainer: HTMLElement | null;
  onMarkerClick: (index: number) => void;
}

// --- Helpers ---

export function getHunkStatus(
  hunkId: string,
  reviewState: ReviewState | null,
  trustList: string[],
  classifyingHunkIds: Set<string>,
): HunkStatus {
  if (classifyingHunkIds.has(hunkId)) return "classifying";
  const hunkState = reviewState?.hunks[hunkId];
  if (!hunkState) return "pending";
  if (hunkState.status === "approved") return "approved";
  if (hunkState.status === "rejected") return "rejected";
  if (isHunkTrusted(hunkState, trustList)) return "trusted";
  return "pending";
}

const STATUS_COLORS: Record<HunkStatus, string> = {
  pending: "bg-stone-500",
  trusted: "bg-cyan-400",
  approved: "bg-lime-400",
  rejected: "bg-rose-400",
  classifying: "bg-violet-400",
};

// --- Component ---

export function DiffMinimap({
  markers,
  scrollContainer,
  onMarkerClick,
}: DiffMinimapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rafId = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Self-manage scroll tracking: attach passive scroll listener + ResizeObserver
  // on the scrollContainer and directly mutate the viewport indicator div.
  useEffect(() => {
    if (!scrollContainer) return;

    const update = () => {
      const el = viewportRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const topPercent =
        scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      const heightPercent =
        scrollHeight > 0 ? Math.min(clientHeight / scrollHeight, 1) * 100 : 100;
      el.style.top = `${topPercent}%`;
      el.style.height = `${heightPercent}%`;
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(update);
    };

    // Initial measurement
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

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only respond to clicks directly on the track (not on markers)
      if (e.target !== e.currentTarget) return;
      if (!scrollContainer) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientY - rect.top) / rect.height;
      const maxScroll =
        scrollContainer.scrollHeight - scrollContainer.clientHeight;
      scrollContainer.scrollTo({
        top: fraction * maxScroll,
        behavior: "smooth",
      });
    },
    [scrollContainer],
  );

  return (
    <div
      className="relative w-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
      onClick={handleTrackClick}
      aria-hidden="true"
    >
      {/* Viewport indicator — positioned via internal scroll tracking */}
      <div
        ref={viewportRef}
        className="absolute left-0 right-0 bg-stone-400/25 border-y border-stone-400/50 pointer-events-none"
        style={{ top: "0%", height: "100%" }}
      />

      {/* Hunk markers */}
      {markers.map((marker, i) => {
        const colorClass = STATUS_COLORS[marker.status];
        const pulseClass =
          marker.status === "classifying" && !prefersReducedMotion
            ? " animate-pulse"
            : "";
        const focusClass = marker.isFocused ? " ring-1 ring-amber-400" : "";

        return (
          <div
            key={marker.id}
            className={`absolute left-0 right-0 rounded-sm ${colorClass}${pulseClass}${focusClass}`}
            style={{
              top: `${marker.topFraction * 100}%`,
              height: `${marker.heightFraction * 100}%`,
              minHeight: "2px",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onMarkerClick(i);
            }}
          />
        );
      })}
    </div>
  );
}
