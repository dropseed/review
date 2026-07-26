import { useReviewStore } from "../../stores";
import { makeReviewKey } from "../../utils/review-key";

interface SidebarRowMenuItemsProps {
  repoPath: string;
  reviewRef: string;
  /** Close the containing context menu after an action. */
  onDone: () => void;
}

const itemClass =
  "w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors";

/**
 * Pin / hide controls for a sidebar row — the manual escape hatches on top of
 * derived liveness. Pinned rows stay up top even once they go quiet; hidden
 * ones drop into the repo's `⋯ more` list. The two states are mutually
 * exclusive (pinning clears a hide and vice-versa), so each is a single toggle.
 */
export function SidebarRowMenuItems({
  repoPath,
  reviewRef,
  onDone,
}: SidebarRowMenuItemsProps) {
  const key = makeReviewKey(repoPath, reviewRef);
  const pinned = useReviewStore((s) => s.sidebarPinned.includes(key));
  const dismissed = useReviewStore((s) => s.sidebarDismissed.includes(key));
  const pinSidebarRow = useReviewStore((s) => s.pinSidebarRow);
  const unpinSidebarRow = useReviewStore((s) => s.unpinSidebarRow);
  const dismissSidebarRow = useReviewStore((s) => s.dismissSidebarRow);
  const undismissSidebarRow = useReviewStore((s) => s.undismissSidebarRow);

  return (
    <>
      <button
        type="button"
        className={itemClass}
        onClick={() => {
          if (pinned) unpinSidebarRow(key);
          else pinSidebarRow(key);
          onDone();
        }}
      >
        {pinned ? "Unpin" : "Pin to top"}
      </button>
      <button
        type="button"
        className={itemClass}
        onClick={() => {
          if (dismissed) undismissSidebarRow(key);
          else dismissSidebarRow(key);
          onDone();
        }}
      >
        {dismissed ? "Always show" : "Hide"}
      </button>
    </>
  );
}
