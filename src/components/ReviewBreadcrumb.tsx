import type { ReactNode } from "react";
import type { Comparison, GitHubPrRef } from "../types";
import { useReviewStore } from "../stores";
import { SidebarPanelIcon } from "./ui/icons";
import { SimpleTooltip } from "./ui/tooltip";

interface ReviewBreadcrumbProps {
  repoName: string;
  comparison: Comparison;
}

function SidebarToggle(): ReactNode {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);
  const changesViewMode = useReviewStore((s) => s.changesViewMode);

  if (!collapsed || changesViewMode === "guide") return null;

  return (
    <SimpleTooltip content="Show sidebar (\u2318B)">
      <button
        type="button"
        onClick={toggleTabRail}
        className="flex items-center justify-center w-7 h-7 rounded-md
                   hover:bg-surface-raised/60 transition-colors duration-100
                   focus:outline-hidden focus:ring-2 focus:ring-edge-default/50
                   text-fg-muted hover:text-fg-secondary"
        aria-label="Show sidebar"
      >
        <SidebarPanelIcon />
      </button>
    </SimpleTooltip>
  );
}

function getOverviewLabel(
  comparison: Comparison,
  githubPr?: GitHubPrRef,
): string {
  if (githubPr) return `PR #${githubPr.number}`;
  return `${comparison.base}..${comparison.head}`;
}

export function ReviewBreadcrumb({
  repoName,
  comparison,
}: ReviewBreadcrumbProps): ReactNode {
  const githubPr = useReviewStore((s) => s.reviewState?.githubPr);
  const gitStatus = useReviewStore((s) => s.gitStatus);
  const isPr = !!githubPr;

  const workingTreeChangeCount =
    (gitStatus?.staged.length ?? 0) +
    (gitStatus?.unstaged.length ?? 0) +
    (gitStatus?.untracked.length ?? 0);
  const showWorkingTree =
    gitStatus?.currentBranch === comparison.head && workingTreeChangeCount > 0;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <SidebarToggle />
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-xs font-medium text-fg-secondary">
          {repoName}
        </span>
        <span className="shrink-0 text-fg-faint text-xs">/</span>
        <span
          className={`shrink-0 text-xs text-fg-muted ${isPr ? "font-medium" : "font-mono"}`}
        >
          {getOverviewLabel(comparison, githubPr)}
        </span>
        {showWorkingTree && (
          <SimpleTooltip content="Includes uncommitted working tree changes">
            <button
              type="button"
              onClick={() => {
                useReviewStore.setState({
                  filesPanelCollapsed: false,
                  requestedFilesPanelTab: "git",
                });
              }}
              className="flex items-center gap-1 ml-0.5 rounded px-1 py-0.5 hover:bg-surface-raised transition-colors"
            >
              <span className="text-xxs text-status-modified/70 font-medium">
                + working tree
              </span>
            </button>
          </SimpleTooltip>
        )}
      </div>
    </div>
  );
}

export function ReviewTitle(): ReactNode {
  const displayTitle = useReviewStore((s) => s.reviewState?.githubPr?.title);
  if (!displayTitle) return null;

  return (
    <div className="truncate text-sm font-medium text-fg-secondary leading-tight px-4 mt-1">
      {displayTitle}
    </div>
  );
}
