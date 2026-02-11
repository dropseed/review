import { useEffect, useRef, useState } from "react";
import { useReviewStore } from "../stores";
import type { Activity } from "../stores/slices/activitySlice";

interface ActivityRowProps {
  activity: Activity;
}

function ActivityRow({ activity }: ActivityRowProps) {
  const hasProgress =
    activity.current != null && activity.total != null && activity.total > 0;

  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-8 shrink-0 rounded-full bg-white/[0.08] overflow-hidden">
        {hasProgress ? (
          <div
            className="h-full bg-amber-400/80 rounded-full transition-[width] duration-300 ease-out"
            style={{
              width: `${Math.round((activity.current! / activity.total!) * 100)}%`,
            }}
          />
        ) : (
          <div className="h-full w-1/3 bg-amber-400/60 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
        )}
      </div>
      <span className="text-[11px] text-stone-400 truncate whitespace-nowrap">
        {activity.label}
        {hasProgress && (
          <span className="ml-1 tabular-nums text-stone-500">
            {activity.current}/{activity.total}
          </span>
        )}
      </span>
    </div>
  );
}

export function ActivityBar() {
  const activities = useReviewStore((s) => s.activities);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sort by priority descending
  const sorted = [...activities.values()].sort(
    (a, b) => b.priority - a.priority,
  );
  const primaryActivity = sorted[0] ?? null;
  const remainingCount = sorted.length - 1;

  // Fade out after last activity ends
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (primaryActivity) {
      setVisible(true);
    } else {
      const timer = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(timer);
    }
  }, [primaryActivity]);

  // Auto-collapse when down to 1 or 0 activities
  useEffect(() => {
    if (sorted.length <= 1) setExpanded(false);
  }, [sorted.length]);

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      className={`absolute left-1/2 top-1.5 -translate-x-1/2 z-10 transition-opacity duration-500 ${primaryActivity ? "opacity-100" : "opacity-0"}`}
    >
      <div className="rounded-2xl border border-white/[0.08] bg-stone-950/80 backdrop-blur-md shadow-lg">
        {/* Primary row */}
        <div
          className="flex items-center gap-2 px-3 py-1 cursor-default"
          onClick={
            remainingCount > 0 ? () => setExpanded(!expanded) : undefined
          }
        >
          {primaryActivity && <ActivityRow activity={primaryActivity} />}
          {remainingCount > 0 && (
            <span className="shrink-0 text-[10px] tabular-nums text-stone-600">
              +{remainingCount}
            </span>
          )}
        </div>

        {/* Expanded list */}
        {expanded && (
          <div className="border-t border-white/[0.06] px-3 py-1.5 flex flex-col gap-1">
            {sorted.slice(1).map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
