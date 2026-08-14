import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { repoDisplayName } from "../../utils/repo-identity";
import {
  focusWorkspace,
  activateAttachment,
} from "../../commands/workspaceCommands";
import type { Workspace } from "../../types";

/** A repo the picker can open, with the branch it would open it at. */
export interface RepoChoice {
  path: string;
  name: string;
  /**
   * The ref the tab is pointed at — whatever the repo has checked out. A hint,
   * so a repo the tree knows nothing about is still worth offering: opening it
   * resolves the ref again at click time.
   */
  refName: string | null;
}

/**
 * A path as a person would write it: `~` for their own home directory.
 *
 * Only the home prefix, and only the shapes macOS and Linux actually use — a
 * path shortened past that stops identifying the directory, which is the whole
 * reason it is being shown.
 */
export function shortPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/**
 * Every repo the app can put on the code side, in the sidebar tree's order.
 *
 * The tree is already the union of the sources a picker would otherwise have to
 * assemble by hand — repos with local activity, repos known only through a
 * saved review, and the repos the viewer's PRs live in — so there is one list
 * of repos in the app rather than the palette's and the picker's.
 */
export function useRepoChoices(): RepoChoice[] {
  const tree = useSidebarTree();
  const repoMetadata = useReviewStore((s) => s.repoMetadata);

  return useMemo(
    () =>
      tree.map((node) => ({
        path: node.repoPath,
        name: repoDisplayName(
          repoMetadata[node.repoPath]?.routePrefix,
          node.repoName,
        ),
        refName: node.head?.ref ?? null,
      })),
    [tree, repoMetadata],
  );
}

/**
 * Open a repo in a workspace: attach it, then show it.
 *
 * Attaching a repo the workspace already shows is not an error and does not
 * open a second tab — the backend moves the existing tab's ref hint — so this
 * doubles as "activate that tab", which is what picking an already-open repo
 * should do.
 */
export async function openRepoIn(
  workspace: Workspace,
  choice: RepoChoice,
): Promise<void> {
  const store = useReviewStore.getState();
  const ok = await store.attachWorkspace(
    workspace.id,
    choice.path,
    choice.refName,
  );
  if (!ok) return;
  // Focus first: the workspace may not be the one on screen (the empty state's
  // picker is), and the code half only draws the focused workspace's tabs.
  focusWorkspace(workspace);
  activateAttachment({ path: choice.path, refName: choice.refName });
}
