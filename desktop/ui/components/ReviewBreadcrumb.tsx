import { useState, type ReactNode } from "react";
import type { Comparison } from "../types";
import { useReviewStore } from "../stores";
import { SidebarPanelIcon } from "./ui/icons";
import { SimpleTooltip } from "./ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ChangeBaseMenu } from "./TabRail/ChangeBaseMenu";

interface ReviewBreadcrumbProps {
  repoName: string;
  comparison: Comparison | null;
}

function SidebarToggle(): ReactNode {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  if (!collapsed) return null;

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

/** The comparison label (or `PR #n`). For the default branch it reads as
 *  "head · N unpushed"; otherwise it's the raw `base..head`. In both non-PR
 *  cases the label opens the base-override menu, with the raw range on hover. */
function ComparisonLabel({
  comparison,
}: {
  comparison: Comparison;
}): ReactNode {
  const githubPr = useReviewStore((s) => s.reviewState?.githubPr);
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const baseReason = useReviewStore((s) => s.baseReason);
  const aheadCount = useReviewStore((s) => s.reviewAheadCount);
  const [baseMenuOpen, setBaseMenuOpen] = useState(false);

  if (githubPr) {
    return (
      <span className="shrink-0 text-xs font-medium text-fg-muted">
        PR #{githubPr.number}
      </span>
    );
  }

  // The default branch reviewed against its remote tip: label it as unpushed
  // work rather than the cryptic `origin/head..head` range.
  const isUnpushed = baseReason === "defaultVsRemote";
  const unpushedSuffix =
    aheadCount && aheadCount > 0 ? `${aheadCount} unpushed` : "unpushed";

  const canChangeBase = !!repoPath && !!reviewRef && comparison.base !== "";

  const label = isUnpushed ? (
    <span className="font-medium">
      {comparison.head} <span className="text-fg-faint">·</span>{" "}
      {unpushedSuffix}
    </span>
  ) : (
    <>
      {comparison.base}..{comparison.head}
    </>
  );

  const title = isUnpushed
    ? `${comparison.base}..${comparison.head} — change base`
    : "Change base";

  const labelClass = isUnpushed
    ? "shrink-0 text-xs text-fg-muted"
    : "shrink-0 text-xs text-fg-muted font-mono";

  if (!canChangeBase) {
    return <span className={labelClass}>{label}</span>;
  }

  return (
    <span className={labelClass}>
      <Popover open={baseMenuOpen} onOpenChange={setBaseMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded text-fg-muted hover:text-fg-secondary hover:underline
                       decoration-dotted underline-offset-2 focus:outline-hidden
                       focus-visible:ring-1 focus-visible:ring-focus-ring/50"
            title={title}
          >
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <ChangeBaseMenu
            repoPath={repoPath}
            refName={reviewRef}
            currentBase={comparison.base}
            onClose={() => setBaseMenuOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}

export function ReviewBreadcrumb({
  repoName,
  comparison,
}: ReviewBreadcrumbProps): ReactNode {
  const currentBranch = useReviewStore((s) => s.currentBranch);

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <SidebarToggle />
      <div className="flex items-center gap-1.5">
        <span className="hidden @md:inline shrink-0 text-xs font-medium text-fg-secondary">
          {repoName}
        </span>
        {comparison ? (
          <>
            <span className="hidden @md:inline shrink-0 text-fg-faint text-xs">
              /
            </span>
            <ComparisonLabel comparison={comparison} />
          </>
        ) : currentBranch ? (
          <>
            <span className="hidden @md:inline shrink-0 text-fg-faint text-xs">
              /
            </span>
            <span className="shrink-0 text-xs text-fg-muted font-mono">
              {currentBranch}
            </span>
          </>
        ) : null}
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
