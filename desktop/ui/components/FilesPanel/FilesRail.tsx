import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { Rail, RailButton, RailSeparator, RailTab } from "../ui/rail";
import { SidebarPanelIcon } from "../ui/icons";
import { useGitTab } from "./hooks/useFilePanelNavigation";
import type { FilesPanelTab } from "./types";

const TABS: { id: FilesPanelTab; text: string; label: string }[] = [
  { id: "changes", text: "Review", label: "Review — files in this comparison" },
  { id: "browse", text: "Browse", label: "Browse — every file in the repo" },
  { id: "search", text: "Search", label: "Search file contents" },
];

/**
 * The files panel's collapsed state — the same rule the sidebar and the
 * terminal follow: hiding a pane leaves a strip on its edge, not nothing.
 *
 * It carries the panel's own tabs rather than just a way back, so collapsed is
 * still a way to reach the file list you want: picking a tab restores the panel
 * with that tab open. The Git tab keeps its count, which is the one thing worth
 * knowing about a panel you can't see — whether there is uncommitted work.
 */
export function FilesRail(): ReactNode {
  const toggleFilesPanel = useReviewStore((s) => s.toggleFilesPanel);
  const setFilesPanelCollapsed = useReviewStore(
    (s) => s.setFilesPanelCollapsed,
  );
  const requestFilesPanelTab = useReviewStore((s) => s.requestFilesPanelTab);
  const comparison = useReviewStore((s) => s.comparison);
  const { showGitTab, gitChangeCount } = useGitTab();

  const open = (tab: FilesPanelTab) => {
    // The panel stays mounted while collapsed, so it is asked for the tab
    // through the same channel every other jump into it uses.
    requestFilesPanelTab(tab);
    setFilesPanelCollapsed(false);
  };

  // Review is about a comparison; without one the panel doesn't offer it.
  const tabs = TABS.filter((tab) => tab.id !== "changes" || comparison);

  return (
    <Rail className="w-9 shrink-0 border-l border-edge bg-surface">
      <RailButton
        label="Show files (⌥⌘B)"
        edge="right"
        onClick={toggleFilesPanel}
      >
        <SidebarPanelIcon className="h-3.5 w-3.5 -scale-x-100" />
      </RailButton>

      <RailSeparator className="w-3 bg-edge/40" />

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {showGitTab && (
          <RailTab
            text="Git"
            label={
              gitChangeCount > 0
                ? `Git — ${gitChangeCount} uncommitted file${gitChangeCount === 1 ? "" : "s"}`
                : "Git — working tree is clean"
            }
            edge="right"
            onClick={() => open("git")}
            marker={
              gitChangeCount > 0 ? (
                <span className="text-xxs tabular-nums text-status-modified">
                  {gitChangeCount}
                </span>
              ) : undefined
            }
          />
        )}
        {tabs.map((tab) => (
          <RailTab
            key={tab.id}
            text={tab.text}
            label={tab.label}
            edge="right"
            onClick={() => open(tab.id)}
          />
        ))}
      </div>
    </Rail>
  );
}
