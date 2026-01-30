import { useState, useMemo, useCallback } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { flattenFilesWithStatus } from "../../stores/types";
import { isHunkTrusted } from "../../types";

interface QuickAction {
  id: string;
  label: string;
  status: "deleted" | "renamed" | "added";
  icon: React.ReactNode;
}

const ACTIONS: QuickAction[] = [
  {
    id: "deleted",
    label: "Approve all deleted files",
    status: "deleted",
    icon: (
      <svg
        className="h-3.5 w-3.5 text-rose-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      </svg>
    ),
  },
  {
    id: "renamed",
    label: "Approve all renamed files",
    status: "renamed",
    icon: (
      <svg
        className="h-3.5 w-3.5 text-blue-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5l7 7-7 7" />
        <path d="M5 12h14" />
      </svg>
    ),
  },
  {
    id: "added",
    label: "Approve all added files",
    status: "added",
    icon: (
      <svg
        className="h-3.5 w-3.5 text-emerald-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    ),
  },
];

export function QuickActionsSection() {
  const files = useReviewStore((s) => s.files);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);

  const [sectionExpanded, setSectionExpanded] = useState(true);

  // Build a Set of file paths per status, then compute pending hunk IDs per action
  const actionData = useMemo(() => {
    const flatFiles = flattenFilesWithStatus(files);

    // Group file paths by status
    const pathsByStatus: Record<string, Set<string>> = {
      deleted: new Set(),
      renamed: new Set(),
      added: new Set(),
    };
    for (const file of flatFiles) {
      if (file.status && file.status in pathsByStatus) {
        pathsByStatus[file.status].add(file.path);
      }
    }

    // For each action, find pending hunk IDs
    const result: Record<string, string[]> = {};
    for (const action of ACTIONS) {
      const matchingPaths = pathsByStatus[action.status];
      if (matchingPaths.size === 0) {
        result[action.id] = [];
        continue;
      }

      const pendingIds: string[] = [];
      for (const hunk of hunks) {
        if (!matchingPaths.has(hunk.filePath)) continue;

        const hunkState = reviewState?.hunks[hunk.id];
        // Skip already approved/rejected hunks
        if (
          hunkState?.status === "approved" ||
          hunkState?.status === "rejected"
        )
          continue;
        // Skip trusted hunks
        if (reviewState && isHunkTrusted(hunkState, reviewState.trustList))
          continue;

        pendingIds.push(hunk.id);
      }
      result[action.id] = pendingIds;
    }

    return result;
  }, [files, hunks, reviewState]);

  const handleApprove = useCallback(
    (actionId: string) => {
      const ids = actionData[actionId];
      if (ids && ids.length > 0) {
        approveHunkIds(ids);
      }
    },
    [actionData, approveHunkIds],
  );

  // Filter to only actions with pending hunks
  const visibleActions = ACTIONS.filter(
    (action) => (actionData[action.id]?.length ?? 0) > 0,
  );

  // Hide entire section if nothing actionable
  if (visibleActions.length === 0) return null;

  return (
    <div className="px-4 mb-6">
      {/* Section header */}
      <button
        className="flex items-center gap-1.5 mb-2 group w-full text-left"
        onClick={() => setSectionExpanded(!sectionExpanded)}
        aria-expanded={sectionExpanded}
      >
        <svg
          className={`h-3 w-3 text-stone-600 transition-transform ${sectionExpanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 6l6 6-6 6" />
        </svg>
        <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide">
          Quick Actions
        </h3>
        <span className="text-xxs tabular-nums text-lime-400/80">
          {visibleActions.length} available
        </span>
      </button>

      {sectionExpanded && (
        <div className="rounded-lg border border-stone-800 overflow-hidden divide-y divide-stone-800/60">
          {visibleActions.map((action) => {
            const pendingCount = actionData[action.id]?.length ?? 0;

            return (
              <div
                key={action.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-stone-800/30 transition-colors"
              >
                {action.icon}
                <span className="flex-1 text-xs text-stone-300">
                  {action.label}
                </span>
                <span className="text-xxs tabular-nums text-stone-500 font-mono">
                  {pendingCount} hunk{pendingCount !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => handleApprove(action.id)}
                  className="rounded px-2.5 py-1 text-2xs font-medium bg-lime-500/10 text-lime-400 ring-1 ring-inset ring-lime-500/20 hover:bg-lime-500/20 hover:text-lime-300 transition-colors"
                >
                  Approve
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
