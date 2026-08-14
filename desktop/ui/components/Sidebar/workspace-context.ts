import { useReviewStore } from "../../stores";
import {
  getSidebarTree,
  sidebarRowsByKey,
} from "../../stores/selectors/sidebar";
import { repoDisplayName } from "../../utils/repo-identity";
import { makeReviewKey } from "../../utils/review-key";
import type { RepoMetadata } from "../../stores/slices/tabRailSlice";
import type {
  GlobalReviewSummary,
  RepoLocalActivity,
  ShippedPr,
  ViewerPrSnapshot,
} from "../../types";
import type { WorkspaceContext } from "./workspace-status";

let cache: { deps: readonly unknown[]; ctx: WorkspaceContext } | null = null;

/**
 * Everything a workspace is described against, built once per state change.
 *
 * Cached on input identity rather than per-consumer `useMemo` — the same
 * pattern as `getSidebarTree`, for the same two reasons: three mounted
 * components ask for this (the queue, the rail, the code-half header), and each
 * `useMemo` produced a *different* context object, which then
 * defeated every `describeWorkspace` memo taking it as a dependency. One shared
 * identity collapses those back into one build and one describe per workspace.
 *
 * The rows come from the same tree ⌘K searches, so a card and the branch it
 * stands for can't disagree about a PR or a working tree.
 */
export function getWorkspaceContext(state: {
  localActivity: RepoLocalActivity[];
  repoMetadata: Record<string, RepoMetadata>;
  globalReviewsByKey: Record<string, GlobalReviewSummary>;
  globalReviews: GlobalReviewSummary[];
  viewerPrs: ViewerPrSnapshot | null;
}): WorkspaceContext {
  const tree = getSidebarTree(state);
  const deps: readonly unknown[] = [
    tree,
    state.localActivity,
    state.repoMetadata,
    state.globalReviewsByKey,
    state.viewerPrs?.shipped,
  ];
  if (cache && deps.every((dep, i) => dep === cache!.deps[i])) return cache.ctx;

  const repoNames = new Map<string, string>();
  const knownRepos = new Set<string>();
  for (const repo of state.localActivity) {
    knownRepos.add(repo.repoPath);
    repoNames.set(
      repo.repoPath,
      repoDisplayName(
        state.repoMetadata[repo.repoPath]?.routePrefix,
        repo.repoName,
      ),
    );
  }

  // Keyed the way an attachment is, so a card looks its own merge up in one step —
  // the backend reports shipped PRs by repo path and head branch precisely so
  // this join needs nothing the workspace doesn't already hold.
  const shipped = new Map<string, ShippedPr>();
  for (const pr of state.viewerPrs?.shipped ?? []) {
    const key = makeReviewKey(pr.repoPath, pr.headRefName);
    // Newest first from the backend, so the first entry for a branch wins —
    // a branch reused for a second PR reports the merge that just happened.
    if (!shipped.has(key)) shipped.set(key, pr);
  }

  const ctx: WorkspaceContext = {
    rows: sidebarRowsByKey(tree),
    repoNames,
    knownRepos,
    reviews: state.globalReviewsByKey,
    shipped,
  };
  cache = { deps, ctx };
  return ctx;
}

/** [`getWorkspaceContext`] as a hook. */
export function useWorkspaceContext(): WorkspaceContext {
  return useReviewStore(getWorkspaceContext);
}
