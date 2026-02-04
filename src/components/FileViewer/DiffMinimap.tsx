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

// Semantic status colors
const STATUS_COLORS: Record<HunkStatus, string> = {
  pending: "bg-status-pending",
  trusted: "bg-status-trusted",
  approved: "bg-status-approved",
  rejected: "bg-status-rejected",
  classifying: "bg-status-classifying",
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

  // Self-manage scroll tracking
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
      className="relative w-3 shrink-0 cursor-pointer group border-l border-stone-800/50"
      onClick={handleTrackClick}
      aria-hidden="true"
    >
      {/* Track background - subtle on hover */}
      <div className="absolute inset-0 bg-gradient-to-b from-stone-900/0 via-stone-800/20 to-stone-900/0 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Viewport indicator */}
      <div
        ref={viewportRef}
        className="absolute left-0 right-0 bg-stone-500/15 border-y border-stone-500/25 pointer-events-none transition-colors group-hover:bg-stone-500/25 group-hover:border-stone-500/40"
        style={{ top: "0%", height: "100%" }}
      />

      {/* Hunk markers */}
      {markers.map((marker, i) => {
        const colorClass = STATUS_COLORS[marker.status];
        const pulseClass =
          marker.status === "classifying" && !prefersReducedMotion
            ? " animate-pulse"
            : "";
        const focusRing = marker.isFocused
          ? " ring-1 ring-amber-400/80 ring-offset-1 ring-offset-stone-900"
          : "";

        return (
          <div
            key={marker.id}
            className={`absolute left-0.5 right-0.5 rounded-[2px] transition-all cursor-pointer hover:left-0 hover:right-0 ${colorClass}${pulseClass}${focusRing}`}
            style={{
              top: `${marker.topFraction * 100}%`,
              height: `${marker.heightFraction * 100}%`,
              minHeight: "3px",
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
