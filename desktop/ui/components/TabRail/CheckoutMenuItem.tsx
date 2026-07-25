import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";

interface CheckoutMenuItemProps {
  repoPath: string;
  reviewRef: string;
  /** The row's current checkout, if it has one. */
  checkoutPath?: string | null;
  onDone: () => void;
}

const itemClass =
  "w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors";

/**
 * Release a row's worktree from its context menu.
 *
 * The inverse of materializing. Review state is untouched — you keep the
 * record and drop the disk, and the row falls back to the fetched tier where
 * the diff still reads fine.
 */
export function CheckoutMenuItem({
  repoPath,
  reviewRef,
  checkoutPath,
  onDone,
}: CheckoutMenuItemProps): ReactNode {
  if (!checkoutPath) return null;

  async function handleRelease(): Promise<void> {
    const { dialogs } = getPlatformServices();
    const client = getApiClient();
    const store = useReviewStore.getState();

    try {
      // Uncommitted work in the worktree would be lost, so surface it before
      // reclaiming rather than after.
      const hasChanges = await client.hasWorktreeChanges(
        repoPath,
        checkoutPath as string,
      );
      const message = hasChanges
        ? `The checkout for "${reviewRef}" has uncommitted changes. Release it anyway?`
        : `Release the checkout for "${reviewRef}"? The review itself is kept.`;
      if (!(await dialogs.confirm(message, "Release checkout"))) return;

      await client.releaseReviewWorktree(repoPath, reviewRef);
      await Promise.all([store.loadLocalActivity(), store.loadGlobalReviews()]);
      if (
        store.activeReviewKey?.repoPath === repoPath &&
        store.activeReviewKey?.ref === reviewRef
      ) {
        await store.loadReviewTier();
      }
    } catch (err) {
      console.error("[tier] Failed to release worktree:", err);
    }
  }

  return (
    <button
      type="button"
      className={itemClass}
      onClick={() => {
        void handleRelease().finally(onDone);
      }}
    >
      Release checkout…
    </button>
  );
}
