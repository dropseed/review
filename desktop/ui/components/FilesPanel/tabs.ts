import type { ComponentType } from "react";
import { BranchIcon, DiffIcon, FileIcon, type IconProps } from "../ui/icons";
import type { FilesPanelTab } from "./types";

/**
 * The panel's tabs, in the order they are shown, with the rule for when each
 * one applies.
 *
 * One table because two things render it: the open panel's tab strip and the
 * collapsed rail. The other two rails derive their contents from the same
 * source their panel does — `SidebarRail` from `useSidebarTree`, `TerminalRail`
 * from `terminalTabs` — and this is how the files panel does it, rather than
 * the rail keeping a second copy that happens to agree.
 */
export interface FilesPanelTabSpec {
  id: FilesPanelTab;
  /** The tab strip's label, and the rail's rotated one. */
  label: string;
  /** Icon-only form the strip falls back to when the words won't fit. */
  icon: ComponentType<IconProps>;
  /** What the rail says about it in full, where a rotated word isn't enough. */
  description: string;
}

export const FILES_PANEL_TABS: readonly FilesPanelTabSpec[] = [
  {
    id: "git",
    label: "Git",
    icon: BranchIcon,
    description: "Git — the working tree",
  },
  {
    id: "changes",
    label: "Review",
    icon: DiffIcon,
    description: "Review — files in this comparison",
  },
  {
    id: "browse",
    label: "Browse",
    icon: FileIcon,
    description: "Browse — every file in the repo",
  },
];

/**
 * The tabs a review can actually show. Git needs a working tree this review is
 * looking at, and Review needs something to compare — both are inapplicable
 * rather than empty, which is the only reason a tab is withheld.
 */
export function visibleFilesPanelTabs(
  hasComparison: boolean,
  showGitTab: boolean,
): FilesPanelTabSpec[] {
  return FILES_PANEL_TABS.filter((tab) => {
    if (tab.id === "git") return hasComparison && showGitTab;
    if (tab.id === "changes") return hasComparison;
    return true;
  });
}
