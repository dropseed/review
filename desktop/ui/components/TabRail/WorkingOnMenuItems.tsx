import { useReviewStore } from "../../stores";
import { makeReviewKey } from "../../utils/review-key";

interface WorkingOnMenuItemsProps {
  repoPath: string;
  reviewRef: string;
  /** Close the containing context menu after an action. */
  onDone: () => void;
}

const itemClass =
  "w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors";

/**
 * Pin / dismiss controls for the zone-1 "Working on" list. Rendered inside the
 * row context menus; the pin and dismiss states are mutually exclusive (pinning
 * clears a dismiss and vice-versa), so each is a single toggle.
 */
export function WorkingOnMenuItems({
  repoPath,
  reviewRef,
  onDone,
}: WorkingOnMenuItemsProps) {
  const key = makeReviewKey(repoPath, reviewRef);
  const pinned = useReviewStore((s) => s.workingOnPinned.includes(key));
  const dismissed = useReviewStore((s) => s.workingOnDismissed.includes(key));
  const pinWorkingOn = useReviewStore((s) => s.pinWorkingOn);
  const unpinWorkingOn = useReviewStore((s) => s.unpinWorkingOn);
  const dismissWorkingOn = useReviewStore((s) => s.dismissWorkingOn);
  const undismissWorkingOn = useReviewStore((s) => s.undismissWorkingOn);

  return (
    <>
      <button
        type="button"
        className={itemClass}
        onClick={() => {
          if (pinned) unpinWorkingOn(key);
          else pinWorkingOn(key);
          onDone();
        }}
      >
        {pinned ? "Unpin from Working on" : "Pin to Working on"}
      </button>
      <button
        type="button"
        className={itemClass}
        onClick={() => {
          if (dismissed) undismissWorkingOn(key);
          else dismissWorkingOn(key);
          onDone();
        }}
      >
        {dismissed ? "Show in Working on" : "Hide from Working on"}
      </button>
    </>
  );
}
