import type { ReactNode } from "react";
import { useSpurStore } from "../../stores";
import { basename } from "../Sidebar/terminal-status-format";
import { activeTabTarget, openTerminalTab } from "./newTab";
import type { Workspace } from "../../types";

/**
 * The offer to start the first terminal — one block, wherever the absence of
 * one is showing.
 *
 * Both places that used to say this said it differently: a sentence stranded in
 * the middle of an empty tab area, and a button pinned to the foot of the empty
 * stage. They are the same moment, so they are the same block now, centred in
 * whatever half it is given and lifted off the true centre so it sits where the
 * eye lands rather than where the box halves.
 */
export function StartTerminal({
  workspace,
}: {
  workspace: Workspace | null;
}): ReactNode {
  // What `activeTabTarget` reads, so the sentence follows the repo tab you
  // switch to rather than freezing on the one that was open when it mounted.
  useSpurStore((s) => s.activeReviewKey?.repoPath);
  const repoPath = activeTabTarget(workspace)?.repoPath ?? null;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs -translate-y-[8vh] text-center">
        <button
          type="button"
          onClick={() => void openTerminalTab(workspace)}
          className="inline-flex items-center gap-2 rounded-md bg-fg/[0.06] px-3 py-1.5
                     text-sm font-medium text-fg-secondary inset-ring-1 inset-ring-fg/10
                     hover:bg-fg/[0.1] focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-focus-ring/70"
        >
          <span>Start a terminal</span>
          <kbd className="font-mono text-fg-faint">⌘T</kbd>
        </button>

        <p className="mt-3 text-pretty text-sm text-fg-faint">
          {repoPath
            ? `Starts in ${basename(repoPath)}.`
            : "Starts in this workspace's repo, or your home folder."}
        </p>
      </div>
    </div>
  );
}
