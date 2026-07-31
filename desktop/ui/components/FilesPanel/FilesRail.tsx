import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { Rail, RailButton, RailSeparator, RailTab } from "../ui/rail";
import { SidebarPanelIcon } from "../ui/icons";
import { useGitTab } from "./hooks/useFilePanelNavigation";
import { visibleFilesPanelTabs } from "./tabs";

/**
 * The files panel's collapsed state — the same rule the sidebar and the
 * terminal follow: hiding a pane leaves a strip on its edge, not nothing.
 *
 * It carries the panel's own tabs rather than just a way back, so collapsed is
 * still a way to reach the file list you want: picking a tab restores the panel
 * with that tab open, and the one you would get back is marked. The Git tab
 * keeps its count, which is the one thing worth knowing about a panel you can't
 * see — whether there is uncommitted work.
 */
export function FilesRail(): ReactNode {
  const setFilesPanelCollapsed = useReviewStore(
    (s) => s.setFilesPanelCollapsed,
  );
  const setFilesPanelTab = useReviewStore((s) => s.setFilesPanelTab);
  const activeTab = useReviewStore((s) => s.filesPanelTab);
  const comparison = useReviewStore((s) => s.comparison);
  const { showGitTab, gitChangeCount } = useGitTab();

  const tabs = visibleFilesPanelTabs(comparison !== null, showGitTab);

  return (
    <Rail className="w-9 shrink-0 border-l border-edge bg-surface">
      <RailButton
        label="Show files (⌥⌘B)"
        edge="right"
        onClick={() => setFilesPanelCollapsed(false)}
      >
        <SidebarPanelIcon className="h-3.5 w-3.5 -scale-x-100" />
      </RailButton>

      <RailSeparator className="w-3 bg-edge/40" />

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {tabs.map((tab) => (
          <RailTab
            key={tab.id}
            text={tab.label}
            label={
              tab.id === "git" && gitChangeCount > 0
                ? `Git — ${gitChangeCount} uncommitted file${
                    gitChangeCount === 1 ? "" : "s"
                  }`
                : tab.description
            }
            edge="right"
            active={tab.id === activeTab}
            onClick={() => {
              setFilesPanelTab(tab.id);
              setFilesPanelCollapsed(false);
            }}
            marker={
              tab.id === "git" && gitChangeCount > 0 ? (
                <span className="text-xxs tabular-nums text-status-modified">
                  {gitChangeCount}
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
    </Rail>
  );
}
