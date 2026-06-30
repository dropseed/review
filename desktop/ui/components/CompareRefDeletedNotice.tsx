import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Comparison } from "../types";
import { useReviewStore } from "../stores";
import { WarningIcon } from "./ui/icons";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ChangeBaseMenu } from "./TabRail/ChangeBaseMenu";

interface CompareRefDeletedNoticeProps {
  repoPath: string;
  comparison: Comparison;
  /** Refs from this comparison that no longer resolve (deleted branches). */
  missingRefs: string[];
}

/**
 * Full-panel notice shown in place of the diff/file list when a comparison's
 * base or compare branch has been deleted. Without this, the diff resolves the
 * missing ref to git's empty tree and every file shows up as a deletion.
 */
export function CompareRefDeletedNotice({
  repoPath,
  comparison,
  missingRefs,
}: CompareRefDeletedNoticeProps): ReactNode {
  const deleteGlobalReview = useReviewStore((s) => s.deleteGlobalReview);
  const navigate = useNavigate();
  const [changeBaseOpen, setChangeBaseOpen] = useState(false);

  const baseMissing = missingRefs.includes(comparison.base);
  const headMissing = missingRefs.includes(comparison.head);

  // A self-comparison (base === head) reports the same ref twice; dedupe so the
  // listing, pluralization, and React keys reflect the distinct branches.
  const distinctRefs = [...new Set(missingRefs)];

  const title =
    baseMissing && headMissing && comparison.base !== comparison.head
      ? "Branches were deleted"
      : baseMissing
        ? "Base branch was deleted"
        : "Compare branch was deleted";

  // This notice only renders for the active comparison, so leaving its now-gone
  // review on screen makes no sense — drop back to the home view after removing.
  const handleRemove = (): void => {
    deleteGlobalReview(repoPath, comparison);
    navigate("/");
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-status-rejected/10">
        <WarningIcon className="h-6 w-6 text-status-rejected" />
      </div>

      <p className="mb-2 text-sm font-medium text-fg-secondary">{title}</p>

      <p className="mb-1 max-w-[340px] text-center text-xs text-fg-muted">
        {distinctRefs.map((ref, i) => (
          <span key={ref}>
            {i > 0 && " and "}
            <code className="font-mono text-fg-secondary">{ref}</code>
          </span>
        ))}{" "}
        no longer {distinctRefs.length > 1 ? "exist" : "exists"} in this
        repository.
      </p>
      <p className="mb-6 max-w-[340px] text-center text-xs text-fg-faint">
        The branch may have been merged or deleted. The diff will return on its
        own if the branch comes back.
      </p>

      <div className="flex items-center gap-2">
        {/* Re-anchoring the base only recovers the review when the base is the
            ref that vanished and the head still exists; offering it for a
            deleted head would leave the comparison just as broken. */}
        {baseMissing && !headMissing && (
          <Popover open={changeBaseOpen} onOpenChange={setChangeBaseOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium
                           text-fg-secondary transition-colors hover:bg-fg/[0.06]"
              >
                Change base…
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-auto p-0">
              <ChangeBaseMenu
                repoPath={repoPath}
                comparison={comparison}
                onClose={() => setChangeBaseOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}

        <button
          type="button"
          onClick={handleRemove}
          className="rounded-lg bg-sage-500 px-3 py-1.5 text-xs font-semibold text-surface
                     transition-colors hover:bg-sage-400"
        >
          Mark done
        </button>
      </div>
    </div>
  );
}
