import { useReviewStore } from "../../stores";
import { makeReviewKey } from "../../utils/review-key";

interface SidebarHideMenuItemProps {
  repoPath: string;
  reviewRef: string;
  /** Close the containing context menu after the action. */
  onDone: () => void;
}

const itemClass =
  "w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors";

/**
 * The hide control for a sidebar row — the manual escape hatch on top of
 * derived liveness. A hidden row drops into the repo's `⋯ more` list however
 * live the rules think it is, so it's a single toggle.
 */
export function SidebarHideMenuItem({
  repoPath,
  reviewRef,
  onDone,
}: SidebarHideMenuItemProps) {
  const key = makeReviewKey(repoPath, reviewRef);
  const dismissed = useReviewStore((s) => s.sidebarDismissed.includes(key));
  const toggleSidebarRowDismissed = useReviewStore(
    (s) => s.toggleSidebarRowDismissed,
  );

  return (
    <button
      type="button"
      className={itemClass}
      onClick={() => {
        toggleSidebarRowDismissed(key);
        onDone();
      }}
    >
      {dismissed ? "Always show" : "Hide"}
    </button>
  );
}
