import { useCallback, useState, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import type {
  Comparison,
  DiffShortStat,
  GlobalReviewSummary,
} from "../../types";

/** Format a branch comparison for display. */
function formatBranchComparison(
  comparison: Comparison,
  defaultBranch?: string,
): string {
  const baseIsDefault =
    defaultBranch !== undefined && comparison.old === defaultBranch;

  if (baseIsDefault) {
    return comparison.new;
  }
  return `${comparison.old}..${comparison.new}`;
}

/** Abbreviate large numbers: 1234 → "1.2k", 56789 → "57k" */
function abbreviateCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
}

/** Format a date as relative age: "2m", "3h", "5d", "2w", "3mo" */
function formatAge(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/** GitHub pull request icon (open state style). */
function PullRequestIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

/** Small SVG circular progress indicator using brand colors. */
function CircleProgress({
  percent,
  size = 14,
}: {
  percent: number;
  size?: number;
}) {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const center = size / 2;
  const isComplete = percent >= 100;

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0"
      aria-label={`${percent}% reviewed`}
    >
      {/* Track ring */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
      />
      {/* Filled arc — sage green in progress, amber when complete */}
      {percent > 0 && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={
            isComplete ? "var(--color-amber-500)" : "var(--color-sage-400)"
          }
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-all duration-300"
        />
      )}
    </svg>
  );
}

interface TabRailItemProps {
  review: GlobalReviewSummary;
  repoName: string;
  defaultBranch?: string;
  isActive: boolean;
  isPinned?: boolean;
  diffStats?: DiffShortStat;
  avatarUrl?: string | null;
  onActivate: () => void;
  onDelete: () => void;
  onTogglePin?: () => void;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  repoName,
  defaultBranch,
  isActive,
  isPinned,
  diffStats,
  avatarUrl,
  onActivate,
  onDelete,
  onTogglePin,
}: TabRailItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const pr = review.comparison.githubPr;
  const isPr = !!pr;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleOverflowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenuPos({ x: rect.left, y: rect.bottom + 2 });
    setShowContextMenu(true);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showContextMenu]);

  // Compute progress from the GlobalReviewSummary fields
  const totalHunks = review.totalHunks;
  const reviewedPercent =
    totalHunks > 0
      ? Math.round(
          ((review.trustedHunks + review.approvedHunks + review.rejectedHunks) /
            totalHunks) *
            100,
        )
      : 0;

  const age = formatAge(review.updatedAt);

  // Line 1: the most identifying info
  const primaryLabel = isPr
    ? pr.title || `PR #${pr.number}`
    : formatBranchComparison(review.comparison, defaultBranch);

  const titleText = isPr
    ? `${repoName} - PR #${pr.number}: ${pr.title}`
    : `${repoName} - ${formatBranchComparison(review.comparison, defaultBranch)}`;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate();
          }
        }}
        onContextMenu={handleContextMenu}
        className={`group relative w-full text-left px-2 py-1.5 rounded-md mb-px cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
        aria-current={isActive ? "true" : undefined}
        title={titleText}
      >
        {/* Active indicator bar */}
        {isActive && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-amber-500/80" />
        )}

        <div className="min-w-0">
          {/* Line 1: primary label + age + progress circle / overflow on hover */}
          <div className="flex items-center gap-1.5 min-w-0">
            {isPr && (
              <PullRequestIcon className="h-3 w-3 shrink-0 text-[#3fb950]" />
            )}
            <span
              className={`text-xs truncate flex-1 min-w-0 ${
                isActive
                  ? "text-stone-100 font-medium"
                  : "text-stone-300 group-hover:text-stone-200"
              }`}
            >
              {primaryLabel}
            </span>
            {/* Right side: age + circle / overflow — stacked grid for no layout shift */}
            <span className="relative grid shrink-0 justify-items-end items-center">
              <span
                className="col-start-1 row-start-1 flex items-center gap-1.5
                               transition-opacity duration-100 group-hover:opacity-0 group-hover:pointer-events-none"
              >
                <span className="text-2xs tabular-nums text-stone-600">
                  {age}
                </span>
                {reviewedPercent > 0 && (
                  <CircleProgress percent={reviewedPercent} />
                )}
              </span>
              <button
                type="button"
                onClick={handleOverflowClick}
                className="col-start-1 row-start-1 flex items-center justify-center
                           h-5 w-5 rounded text-stone-500 hover:text-stone-300
                           hover:bg-white/[0.08] opacity-0 pointer-events-none
                           group-hover:opacity-100 group-hover:pointer-events-auto
                           transition-opacity duration-100"
                aria-label="Review options"
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
            </span>
          </div>
          {/* Line 2: repo name + PR number or diff stats */}
          <div className="flex items-center gap-1 mt-0.5 min-w-0">
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                className="h-3 w-3 shrink-0 rounded-sm"
              />
            )}
            <span className="text-2xs text-stone-500 truncate min-w-0">
              {review.repoName}
              {isPr && ` · #${pr.number}`}
            </span>
            <span className="flex-1" />
            {diffStats &&
              (diffStats.additions > 0 || diffStats.deletions > 0) && (
                <span className="flex items-center gap-1.5 text-2xs tabular-nums leading-none shrink-0">
                  {diffStats.additions > 0 && (
                    <span className="text-sage-400">
                      +{abbreviateCount(diffStats.additions)}
                    </span>
                  )}
                  {diffStats.deletions > 0 && (
                    <span className="text-terracotta-400">
                      -{abbreviateCount(diffStats.deletions)}
                    </span>
                  )}
                </span>
              )}
          </div>
        </div>
      </div>

      {/* Context menu — portaled to body to escape backdrop-blur containing block */}
      {showContextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[160px] rounded-lg border border-white/[0.08] bg-stone-800/90 backdrop-blur-xl py-1 shadow-xl"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            {onTogglePin && (
              <>
                <button
                  onClick={() => {
                    setShowContextMenu(false);
                    onTogglePin();
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-white/[0.08] transition-colors"
                >
                  {isPinned ? "Unpin Review" : "Pin Review"}
                </button>
                <div className="my-1 h-px bg-white/[0.06]" />
              </>
            )}
            <button
              onClick={() => {
                setShowContextMenu(false);
                onDelete();
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-white/[0.08] transition-colors"
            >
              Delete Review
            </button>
          </div>,
          document.body,
        )}
    </>
  );
});
