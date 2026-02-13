import { type ReactNode, useMemo } from "react";
import type { HunkGroup, DiffHunk, HunkState } from "../../types";
import { HunkPreview } from "../FileViewer/annotations/HunkPreview";
import { NarrativeContent } from "./NarrativeContent";

function CheckIcon({
  className = "w-3.5 h-3.5",
  strokeWidth = 3,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  );
}

function XIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-cyan-400 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CommentIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
      />
    </svg>
  );
}

interface GroupCardProps {
  group: HunkGroup;
  isActive: boolean;
  unreviewedCount: number;
  hunkById: Map<string, DiffHunk>;
  hunkStates: Record<string, HunkState> | undefined;
  identicalCount: number;
  compact?: boolean;
  onApproveAll: (group: HunkGroup) => void;
  onRejectAll: (group: HunkGroup) => void;
  onUnapproveAll: (group: HunkGroup) => void;
  onApproveIdentical: (group: HunkGroup) => void;
  onApproveHunk: (hunkId: string) => void;
  onRejectHunk: (hunkId: string) => void;
  onCommentHunk: (hunkId: string) => void;
  onReviewIndividually: (group: HunkGroup) => void;
  onActivate: () => void;
}

/**
 * Returns the appropriate color classes based on the card's visual state.
 * Avoids nested ternaries per project conventions.
 */
function cardColorClasses(
  isCompleted: boolean,
  isActive: boolean,
): {
  border: string;
  icon: string;
  title: string;
  badge: string;
} {
  if (isCompleted) {
    return {
      border: "border-emerald-500/20 bg-emerald-500/5",
      icon: "text-emerald-400",
      title: "text-emerald-300",
      badge: "bg-emerald-500/15 text-emerald-400",
    };
  }
  if (isActive) {
    return {
      border: "border-amber-500/30 bg-amber-500/5",
      icon: "text-amber-400",
      title: "text-stone-200",
      badge: "bg-stone-800 text-stone-400",
    };
  }
  return {
    border: "border-stone-800 hover:border-stone-700",
    icon: "text-stone-500",
    title: "text-stone-400",
    badge: "bg-stone-800 text-stone-600",
  };
}

export function GroupCard({
  group,
  isActive,
  unreviewedCount,
  hunkById,
  hunkStates,
  identicalCount,
  compact,
  onApproveAll,
  onRejectAll,
  onUnapproveAll,
  onApproveIdentical,
  onApproveHunk,
  onRejectHunk,
  onCommentHunk,
  onReviewIndividually,
  onActivate,
}: GroupCardProps): ReactNode {
  const isCompleted = unreviewedCount === 0;
  const colors = cardColorClasses(isCompleted, isActive);
  const isSingleHunk = group.hunkIds.length === 1;

  const fileCount = useMemo(() => {
    const files = new Set<string>();
    for (const id of group.hunkIds) {
      const h = hunkById.get(id);
      if (h) files.add(h.filePath);
    }
    return files.size;
  }, [group.hunkIds, hunkById]);

  // Compact mode: single-line completed group
  if (compact) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-left hover:bg-stone-800/30 transition-colors"
      >
        <span className="text-emerald-400 shrink-0">
          <CheckIcon className="w-3 h-3" />
        </span>
        <span className="text-xs text-stone-500 truncate flex-1">
          {group.title}
        </span>
        <span className="text-xxs text-stone-600 shrink-0">done</span>
      </button>
    );
  }

  return (
    <div className={`rounded-lg border transition-all ${colors.border}`}>
      <button
        type="button"
        onClick={onActivate}
        className="flex items-center gap-3 w-full px-4 py-3 text-left"
      >
        <span className={`shrink-0 ${colors.icon}`}>
          {isCompleted ? <CheckIcon /> : <GroupIcon />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${colors.title}`}>
              {group.title}
            </span>
            {fileCount > 1 && (
              <span className="text-xxs text-stone-600">{fileCount} files</span>
            )}
          </div>
        </div>

        <span
          className={`shrink-0 font-mono text-xs tabular-nums px-2 py-0.5 rounded-full ${colors.badge}`}
        >
          {isCompleted ? "done" : unreviewedCount}
        </span>
      </button>

      {isActive && (
        <div className="px-4 pb-4 space-y-3">
          {group.description && (
            <NarrativeContent
              content={group.description}
              className="text-xs text-stone-400 leading-relaxed"
            />
          )}

          <div className="space-y-2">
            {group.hunkIds.map((id) => {
              const hunk = hunkById.get(id);
              if (!hunk) return null;
              const state = hunkStates?.[id];
              const isReviewed = !!state?.status;

              return (
                <div key={id} className="group relative">
                  <HunkPreview hunk={hunk} hunkState={state} compact />
                  {!isReviewed && (
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => onApproveHunk(id)}
                        className="p-1 rounded bg-stone-800/90 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        title="Approve"
                      >
                        <CheckIcon strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRejectHunk(id)}
                        className="p-1 rounded bg-stone-800/90 text-rose-400 hover:bg-rose-500/20 transition-colors"
                        title="Reject"
                      >
                        <XIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onCommentHunk(id)}
                        className="p-1 rounded bg-stone-800/90 text-stone-400 hover:bg-stone-700 transition-colors"
                        title="Comment"
                      >
                        <CommentIcon />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isCompleted && identicalCount > 0 && (
            <IdenticalHint
              count={identicalCount}
              onClick={() => onApproveIdentical(group)}
            />
          )}

          <div className="flex items-center gap-2">
            {isCompleted ? (
              <button
                type="button"
                onClick={() => onUnapproveAll(group)}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                           text-stone-400 hover:text-amber-400 hover:bg-amber-500/10"
              >
                Unapprove{!isSingleHunk && ` all ${group.hunkIds.length}`}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onApproveAll(group)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                             bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                >
                  Approve{!isSingleHunk && ` all ${unreviewedCount}`}
                </button>
                <button
                  type="button"
                  onClick={() => onReviewIndividually(group)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                             text-stone-400 hover:text-stone-200 hover:bg-stone-800"
                >
                  Open in diff view
                </button>
                <button
                  type="button"
                  onClick={() => onRejectAll(group)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                             text-stone-500 hover:text-rose-400 hover:bg-rose-500/10"
                >
                  Reject{!isSingleHunk && " all"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IdenticalHint({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full rounded-md border border-dashed border-stone-700
                 px-3 py-2 text-left hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-colors"
    >
      <CopyIcon />
      <span className="text-xs text-stone-400">
        <span className="text-cyan-400 font-medium">
          {count} identical hunk{count !== 1 ? "s" : ""}
        </span>{" "}
        in other files — approve them too
      </span>
    </button>
  );
}
