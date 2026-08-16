import type { ReactNode } from "react";
import { useFocusedWorkspace } from "../../stores/selectors/workspaces";
import {
  useTerminalsByWorkspaceId,
  workspaceTerminals,
} from "../../stores/selectors/terminals";
import { StartTerminal } from "../Terminal/StartTerminal";
import { RepoPicker } from "./RepoPicker";
import { openRepoIn, useAttachedKeys } from "./repo-choices";
import type { Workspace } from "../../types";

/**
 * A workspace with nothing in it yet: the two things that fill it, in the two
 * places they will fill.
 *
 * The same frame the working layout uses — shells on the left, repos on the
 * right — so starting a terminal and opening a repo happen where those things
 * are about to appear rather than in a dialog that then goes away. An empty
 * workspace is an ordinary state now (the sidebar's `+` makes one directly), so
 * this is a first screen rather than a fallback.
 *
 * Each half centres one block and says nothing else: no label naming the half
 * it is already standing in, and no sentence pinned to an edge. Both blocks
 * carry the same optical lift, so they sit on one line across the two halves.
 *
 * Once a workspace has terminals, the dock owns the left half and this is the
 * repo side alone.
 */
export function EmptyStage(): ReactNode {
  const workspace = useFocusedWorkspace();
  const terminals = useTerminalsByWorkspaceId();

  if (!workspace) return null;

  const own = workspaceTerminals(terminals, workspace.id);
  // The terminal dock draws the left half as soon as there is anything to draw
  // there — see `TerminalDock`. Offering our own "start a terminal" beside it
  // would be the same verb twice.
  const dual = own.tabs === 0 && workspace.attachments.length === 0;

  return (
    // Stacked at phone width rather than two columns of 180px: the frame is
    // meant to say "shells go here, repos go there", and two unreadable
    // columns say neither.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 md:flex-row">
      {dual && (
        <section className="panel-card flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel">
          <StartTerminal workspace={workspace} />
        </section>
      )}

      <RepoHalf workspace={workspace} />
    </div>
  );
}

/** The hero: the one thing an empty workspace is actually waiting for. */
function RepoHalf({ workspace }: { workspace: Workspace }): ReactNode {
  const attached = useAttachedKeys(workspace);

  return (
    <section className="panel-card flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-surface-panel px-4">
      <div className="w-full max-w-sm -translate-y-[8vh]">
        <h2 className="text-sm font-medium text-fg-secondary">Open a repo</h2>
        <div className="mt-3">
          <RepoPicker
            autoFocus
            attached={attached}
            onPick={(choice) => void openRepoIn(workspace, choice)}
          />
        </div>
      </div>
    </section>
  );
}
