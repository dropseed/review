import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { getTabsByWorkspaceId } from "../../stores/selectors/terminals";
import {
  CHECKOUT_REF,
  focusedWorkspaceIn,
} from "../../stores/selectors/workspaceData";
import { getPlatformServices } from "../../platform";
import { openTerminalTab } from "../Terminal/newTab";
import { repoDirname, repoDisplayName } from "../../utils/repo-identity";
import { focusWorkspace, newWorkspace } from "../../commands/workspaceCommands";
import type { Workspace } from "../../types";

/** A repo the picker can open, with the branch it would open it at. */
export interface RepoChoice {
  path: string;
  name: string;
  /**
   * The ref the tab is pointed at — whatever the repo has checked out, or the
   * branch of the worktree this row stands for. A hint, so a repo the tree
   * knows nothing about is still worth offering: opening it resolves the ref
   * again at click time.
   */
  refName: string | null;
  /**
   * Where this ref lives on disk when it has a checkout of its own, else null.
   * Only shown — the attachment is still the repo at a ref, because the tab is
   * the *repo* and walking its branches must not open a second one.
   */
  worktreePath: string | null;
}

/**
 * The identity of a repo-at-a-ref — what tells a repo's own row apart from the
 * rows its worktrees contribute, since those differ by ref alone.
 *
 * Derived on demand rather than carried on `RepoChoice`: a field that is always
 * `f(path, refName)` of its own neighbours is an invariant every future literal
 * has to remember, and the fixtures were already paying for it.
 *
 * Joined on a NUL because it is the one byte neither a path nor a ref can hold,
 * so no pair of them can collide on a key — and written as an escape, because a
 * raw one in the source makes the whole file binary to every tool that reads
 * it, `git diff` included.
 */
export function repoChoiceKey(path: string, refName: string | null): string {
  return `${path}\u0000${refName ?? ""}`;
}

/**
 * The `repoChoiceKey`s a workspace already has open, for marking picker rows.
 *
 * Shared by the two front doors — the repo strip's `+` and the empty state's
 * right half — so the key convention and everything that reads it live in one
 * file. They had drifted into identical five-line memos, edited in lockstep.
 */
export function useAttachedKeys(workspace: Workspace): ReadonlySet<string> {
  return useMemo(
    () =>
      new Set(
        workspace.attachments.map((a) => repoChoiceKey(a.path, a.refName)),
      ),
    [workspace],
  );
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
 * Every checkout the app can put on the code side, in the sidebar tree's order:
 * each repo, followed by each worktree it already has on disk.
 *
 * The tree is already the union of the sources a picker would otherwise have to
 * assemble by hand — repos with local activity, repos known only through a
 * saved review, and the repos the viewer's PRs live in — so there is one list
 * of repos in the app rather than the palette's and the picker's.
 *
 * A worktree earns a row because it is a checkout someone deliberately made and
 * is a place work is already happening; picking one should not mean opening the
 * repo and then hunting for the branch. It is still offered as the repo *at a
 * ref* rather than as its own path: the tab is the repo, and a workspace shows
 * a path at most once, so a worktree row moves the existing tab's ref rather
 * than opening a second tab onto the same repository.
 */
export function useRepoChoices(): RepoChoice[] {
  const tree = useSidebarTree();
  const repoMetadata = useReviewStore((s) => s.repoMetadata);

  return useMemo(
    () =>
      tree.flatMap((node) => {
        const name = repoDisplayName(
          repoMetadata[node.repoPath]?.routePrefix,
          node.repoName,
        );
        const repo: RepoChoice = {
          path: node.repoPath,
          name,
          refName: node.head?.ref ?? null,
          worktreePath: null,
        };
        // A checkout that isn't the repo root is a worktree. Rows without one
        // (a bare branch, a remote ref, a PR nobody has fetched) are branches
        // you could open, not places that exist — ⌘K is where those live.
        const worktrees = node.rows
          .filter(
            (row) =>
              row.checkoutPath !== null && row.checkoutPath !== node.repoPath,
          )
          .map((row): RepoChoice => ({
            path: node.repoPath,
            name,
            refName: row.ref,
            worktreePath: row.checkoutPath,
          }));
        return [repo, ...worktrees];
      }),
    [tree, repoMetadata],
  );
}

/**
 * Open a repo in a workspace: attach it, show it, and — when the workspace is
 * not running anything yet — start a shell in it.
 *
 * Attaching a repo the workspace already shows is not an error and does not
 * open a second tab — the backend moves the existing tab's ref hint — so this
 * doubles as "activate that tab", which is what picking an already-open repo
 * should do.
 *
 * The terminal is the point of the workspace, not a second decision: a fresh
 * workspace's whole first screen is "pick a repo", and every time the answer
 * was followed by ⌘T in the same directory the pick already named. It is
 * offered only while the workspace holds no terminals at all, so opening a
 * second repo alongside work in progress stays silent — that is a repo you
 * wanted to *read*, and a shell nobody asked for would steal the stage.
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
  // Named rather than left to the workspace's first tab, the way
  // `openRowInWorkspace` names its row's: the workspace may not be the one on
  // screen (the empty state's picker is), and on a multi-repo workspace the
  // first tab is precisely the one this pick is not. Passing it here is also
  // what stops this opening two comparisons — it used to focus, let that open
  // tab one, and then activate the pick over the top of it.
  focusWorkspace(workspace, {
    repoPath: choice.path,
    ref: choice.refName ?? CHECKOUT_REF,
  });

  const running = getTabsByWorkspaceId(useReviewStore.getState())[workspace.id];
  if (running && running.length > 0) return;
  // Named here too rather than left to `activeTabTarget`, for the extra reason
  // that the store's notion of the active tab is a render behind the attach
  // just made.
  await openTerminalTab(
    workspace,
    { repoPath: choice.path, ref: choice.refName ?? CHECKOUT_REF },
    // The gesture was "open this repo", so the stage stays on the repo. The
    // shell is a courtesy; taking the screen for it would answer a different
    // question than the one asked — and at phone width it would replace the
    // half the pick was made in.
    { reveal: false },
  );
}

/**
 * Ask the OS for a folder, as a choice the picker's own rows are made of.
 *
 * Nothing is validated. Anything with files in it can be opened now — a repo
 * with no commits, a directory that was never one — so a dialog that refused
 * everything but a git checkout would be turning away the case this exists for.
 * What it *is* gets settled once, when the code half opens it.
 *
 * Resolves to null when the person cancelled, and when the platform has no
 * picker to show them.
 */
export async function chooseFolder(): Promise<RepoChoice | null> {
  const path = await getPlatformServices().dialogs.openDirectory({
    title: "Open Folder",
  });
  if (!path) return null;
  return {
    path,
    // No sidebar row to take a display name from — this folder may be one the
    // app has never seen. Its own basename is what the tab would say anyway.
    name: repoDirname(path),
    // The folder is the whole of what was picked. Whether it has branches is
    // git's answer, asked at open time.
    refName: null,
    worktreePath: null,
  };
}

/**
 * ⌘O: pick a folder and open it where the person is standing.
 *
 * The focused workspace takes it, and with none focused a fresh one is made to
 * hold it — the app's one navigation axis is the workspace, so a folder opened
 * into nothing would be a screen no card stands for.
 *
 * A cancelled dialog and a workspace that could not be made are both "nothing
 * opened", and no caller tells either from success: ⌘O and the picker's row
 * both simply stop.
 */
export async function openFolderInFocusedWorkspace(): Promise<void> {
  const choice = await chooseFolder();
  if (!choice) return;

  const workspace =
    focusedWorkspaceIn(useReviewStore.getState()) ?? (await newWorkspace());
  if (!workspace) return;

  await openRepoIn(workspace, choice);
}
