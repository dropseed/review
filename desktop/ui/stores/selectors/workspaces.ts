import { useMemo } from "react";
import { useReviewStore } from "../index";
import { focusedWorkspace } from "./workspaceData";
import type { Workspace } from "../../types";

export {
  attachmentIndex,
  attachmentLabel,
  comparisonTarget,
  focusedWorkspace,
  hasRef,
  previewRoute,
  repoHosts,
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
  const focusedId = useReviewStore((s) => s.focusedWorkspaceId);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);

  return useMemo(
    () => focusedWorkspace(workspaces, focusedId, activeReviewKey),
    [workspaces, focusedId, activeReviewKey],
  );
}
