import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { useFileDiff } from "../stores/selectors/hunks";

/**
 * Consume a pending review:// deep-link target once hunks for the requested
 * file are loaded. Resolves the hunk hash to a hunk ID (`{filePath}:{hash}`)
 * and applies it as `selectedFile` + `focusedHunkId` + `scrollTarget`.
 *
 * Runs at the review-shell level so it works whether the deep link arrives
 * on cold start (signal file) or warm (cli:open-review event).
 *
 * Pass `enabled = false` to hold the pending target instead of consuming it
 * (e.g. while the compared branch is gone and the only loaded diff is the
 * bogus all-deleted one). The link is then resolved against the real diff once
 * the branch — and `enabled` — come back.
 */
export function useDeepLinkFocus(enabled = true): void {
  const pending = useReviewStore((s) => s.pendingDeepLinkFocus);
  const fileDiff = useFileDiff(pending?.filePath ?? null);

  useEffect(() => {
    if (!enabled || !pending || !fileDiff?.hunks) return;

    const { hunkHash, filePath } = pending;
    const hunkId = hunkHash ? `${filePath}:${hunkHash}` : null;
    const hunkExists =
      hunkId !== null && fileDiff.hunks.some((h) => h.id === hunkId);

    useReviewStore.setState({
      selectedFile: filePath,
      focusedHunkId: hunkExists ? hunkId : null,
      scrollTarget: hunkExists ? { type: "hunk", hunkId } : null,
      pendingDeepLinkFocus: null,
    });
  }, [enabled, pending, fileDiff]);
}
