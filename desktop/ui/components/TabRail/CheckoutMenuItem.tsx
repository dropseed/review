import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import { useAsyncAction } from "../../hooks/useAsyncAction";

interface CheckoutMenuItemProps {
  repoPath: string;
  reviewRef: string;
  /** The row's current checkout, if it has one. */
  checkoutPath?: string | null;
  onDone: () => void;
}

const itemClass =
  "w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] " +
  "transition-colors disabled:opacity-50";

/**
 * Release a row's checkout from its context menu.
 *
 * The inverse of materializing. Review state is untouched — you keep the record
 * and drop the disk, and the row falls back to the fetched tier where the diff
 * still reads fine.
 */
export function CheckoutMenuItem({
  repoPath,
  reviewRef,
  checkoutPath,
  onDone,
}: CheckoutMenuItemProps): ReactNode {
  const releaseCheckout = useReviewStore((s) => s.releaseCheckout);

  const [handleRelease, releasing] = useAsyncAction(async () => {
    if (!checkoutPath) return;
    const { dialogs } = getPlatformServices();

    // Uncommitted work in the checkout would be lost, so surface it before
    // reclaiming rather than after.
    const hasChanges = await getApiClient()
      .hasWorktreeChanges(repoPath, checkoutPath)
      .catch(() => false);
    const message = hasChanges
      ? `The checkout for "${reviewRef}" has uncommitted changes. Release it anyway?`
      : `Release the checkout for "${reviewRef}"? The review itself is kept.`;
    if (!(await dialogs.confirm(message, "Release checkout"))) return;

    await releaseCheckout(repoPath, reviewRef);
  }, "release checkout");

  if (!checkoutPath) return null;

  return (
    <button
      type="button"
      className={itemClass}
      disabled={releasing}
      onClick={() => {
        handleRelease();
        onDone();
      }}
    >
      Release checkout…
    </button>
  );
}
