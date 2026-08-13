import { memo, useCallback } from "react";
import { useReviewStore } from "../../stores";
import type { ViewerPr } from "../../types";
import { RowStatus } from "./RowStatus";
import { ActionContextMenu } from "./ActionMenu";
import { refRowActions, useAddToWork } from "./work-actions";
import { useWorkRefDrag } from "./work-row-drag";
import { ROW_STATUS } from "./row-chrome";

interface OpenPrItemProps {
  pr: ViewerPr;
  repoPath: string;
  onActivate: (pr: ViewerPr) => void;
}

/**
 * A PR of yours that this repo has no local row for.
 *
 * It renders at the listed tier — faint, with the "nothing fetched yet" dot —
 * because that is exactly what it is: Review knows the PR exists and nothing
 * more. Clicking it fetches the head and writes the review, at which point the
 * tree stops synthesizing this row and the real one takes over. Nothing is
 * created before that click, so a sidebar full of these costs nothing on disk.
 */
export const OpenPrItem = memo(function OpenPrItem({
  pr,
  repoPath,
  onActivate,
}: OpenPrItemProps) {
  // Its review identity is the PR's head branch — the ref the review will be
  // keyed by once it exists, so the row highlights the moment it's activated.
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.ref === pr.headRefName,
  );

  const handleClick = useCallback(() => onActivate(pr), [onActivate, pr]);

  const workDragProps = useWorkRefDrag(repoPath, pr.headRefName);
  const addToWork = useAddToWork(repoPath, pr.headRefName);
  const actions = refRowActions({
    ref: pr.headRefName,
    addToWork,
    openPr: pr,
    onOpen: handleClick,
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <ActionContextMenu actions={actions}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...workDragProps}
        className={`group relative w-full text-left px-2.5 py-1 rounded cursor-default
                  transition-colors duration-100
                  ${isActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.03]"}`}
        aria-current={isActive ? "true" : undefined}
        title={`${pr.repoNameWithOwner} — #${pr.number}: ${pr.title}\n${pr.headRefName} → ${pr.baseRefName}`}
      >
        {isActive && (
          <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-full bg-fg/30" />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-xs truncate flex-1 min-w-0 ${
              isActive
                ? "text-fg-secondary font-medium"
                : "text-fg-faint/60 group-hover:text-fg-faint"
            }`}
          >
            <span className="tabular-nums">#{pr.number}</span> {pr.title}
          </span>
          <span className={ROW_STATUS}>
            <RowStatus checkoutPath={null} tier="listed" openPr={pr} />
          </span>
        </div>
      </div>
    </ActionContextMenu>
  );
});
