import { useMemo } from "react";
import { useReviewStore } from "../index";
import { focusedWorkspaceIn } from "./workspaceData";
import type { Workspace } from "../../types";

export {
  CHECKOUT_REF,
  attachmentIndex,
  attachmentLabel,
  comparisonTarget,
  focusedWorkspace,
  focusedWorkspaceIn,
  hasRef,
  isCheckoutTarget,
  previewRoute,
  repoHosts,
  repoOnScreen,
  showingRepo,
  type ReviewTarget,
  type RoutePreview,
} from "./workspaceData";

/** The user's workspaces, in priority order. */
export function useWorkspaces(): Workspace[] {
  return useReviewStore((s) => s.workspaces);
}

/**
 * The workspace the stage is showing — [`focusedWorkspace`] memoized.
 *
 * Opening a comparison outside the explicitly focused workspace clears that
 * pick (see `setActiveReviewKey`), so the explicit id and the derived answer
 * can't drift apart.
 */
export function useFocusedWorkspace(): Workspace | null {
  const workspaces = useWorkspaces();
  const focusedWorkspaceId = useReviewStore((s) => s.focusedWorkspaceId);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const repoPath = useReviewStore((s) => s.repoPath);

  // Memoized rather than one `useReviewStore(focusedWorkspaceIn)`: the
  // derivation builds a repo index over the whole queue, and a plain selector
  // would rebuild it on every store event, terminal output included.
  return useMemo(
    () =>
      focusedWorkspaceIn({
        workspaces,
        focusedWorkspaceId,
        activeReviewKey,
        repoPath,
      }),
    [workspaces, focusedWorkspaceId, activeReviewKey, repoPath],
  );
}
