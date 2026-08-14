import { type ReactNode, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { useFocusedWorkspace } from "../../stores/selectors/workspaces";
import { useTerminalDockPresent } from "../../stores/selectors/terminals";
import { FocusToggle } from "./FocusToggle";
import { activateAttachment } from "../../commands/workspaceCommands";
import { getCommandUi } from "../../commands/host";
import { useWorkspaceContext } from "../Sidebar/workspace-context";
import { describeWorkspace } from "../Sidebar/workspace-status";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { RepoPicker } from "./RepoPicker";
import { openRepoIn } from "./repo-choices";
import type { Workspace } from "../../types";

/**
 * The code half's own header: which repos this workspace is showing, and which
 * one you are looking at.
 *
 * The mirror of the terminal panel's tab strip — same height, same tab shape —
 * so the two halves read as a pair: shells on one side, repos on the other,
 * each with its own `+`. One repo still gets a strip: the `+` is how the second
 * one gets opened, and a bar that appeared only once you had two would hide the
 * gesture that gets you there.
 *
 * Repo tabs, and this half's own Focus toggle at the far end. The
 * Review/Git/Browse strip used to be portalled up here; it belongs to the panel
 * it switches, and now sits inside it.
 */
export function CodeHalfHeader(): ReactNode {
  const workspace = useFocusedWorkspace();
  // Nothing to take the stage from when the terminal half isn't there.
  const docked = useTerminalDockPresent();

  return (
    <div className="flex shrink-0 select-none items-center gap-1 border-b border-edge/60 px-1.5 py-1">
      {workspace && <RepoTabs workspace={workspace} />}
      {docked && (
        <div className="ml-auto flex shrink-0 items-center pl-1">
          <FocusToggle half="code" />
        </div>
      )}
    </div>
  );
}

function RepoTabs({ workspace }: { workspace: Workspace }): ReactNode {
  const ctx = useWorkspaceContext();
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const detachWorkspace = useReviewStore((s) => s.detachWorkspace);

  const repos = useMemo(
    () => describeWorkspace(workspace, ctx).repos,
    [workspace, ctx],
  );
  // By repo, not by review key: the tab stays the tab while you walk that
  // repo's branches, because the ref an attachment carries is a hint about
  // where it was pointed, not the identity of the tab.
  const activePath = activeReviewKey?.repoPath ?? null;

  /**
   * Close a tab. The neighbour takes over when the closed tab was the one on
   * screen — the tab to its right, or its left at the end of the strip — and
   * the last one closing leaves the workspace on its empty state.
   */
  async function close(path: string): Promise<void> {
    const at = workspace.attachments.findIndex(
      (attachment) => attachment.path === path,
    );
    const ok = await detachWorkspace(workspace.id, path);
    if (!ok || path !== activePath) return;
    const next =
      workspace.attachments[at + 1] ?? workspace.attachments[at - 1] ?? null;
    if (!next || !activateAttachment(next)) getCommandUi().navigate("/");
  }

  return (
    <div className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto scrollbar-thin">
      {repos.map((repo) => {
        const isActive = repo.attachment.path === activePath;
        return (
          <div
            key={repo.attachment.path}
            className={clsx(
              "group relative flex shrink-0 items-center rounded-md text-xs",
              isActive
                ? "bg-surface-raised text-fg-secondary"
                : "text-fg-muted hover:bg-fg/[0.06]",
            )}
          >
            <button
              type="button"
              onClick={() => activateAttachment(repo.attachment)}
              aria-current={isActive ? "true" : undefined}
              title={repo.attachment.path}
              className="max-w-[14rem] truncate py-1 pl-2 pr-1.5"
            >
              <span className={clsx(repo.gone && "line-through opacity-60")}>
                {repo.chipLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void close(repo.attachment.path)}
              aria-label={`Close ${repo.chipLabel}`}
              className="pr-1.5 text-fg-faint opacity-0 transition-opacity duration-100
                         hover:text-fg-secondary focus-visible:opacity-100
                         group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
      <AddRepoTab workspace={workspace} />
    </div>
  );
}

/** The strip's `+`: pick a repo, and it becomes the tab you are on. */
function AddRepoTab({ workspace }: { workspace: Workspace }): ReactNode {
  const [open, setOpen] = useState(false);
  const attached = useMemo(
    () => new Set(workspace.attachments.map((a) => a.path)),
    [workspace],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open a repo"
          title="Open a repo"
          className="shrink-0 rounded-md px-2 py-1 text-sm leading-none text-fg-muted
                     hover:bg-fg/[0.06] hover:text-fg-secondary"
        >
          +
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-72 p-2">
        <RepoPicker
          autoFocus
          attached={attached}
          onPick={(choice) => {
            setOpen(false);
            void openRepoIn(workspace, choice);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
