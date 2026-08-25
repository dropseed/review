import type { ComponentType } from "react";
import { BranchIcon, DiffIcon, FileIcon, type IconProps } from "../ui/icons";
import type { Comparison } from "../../types";
import { refLabel } from "./refLabel";
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

export interface FilesPanelTabState extends FilesPanelTabSpec {
  /** Listed, but nothing to open. */
  disabled: boolean;
  /** Why — the tooltip, since a disabled tab can't say it any other way. */
  disabledReason?: string;
}

/**
 * The tabs a review shows, and which of them can be opened.
 *
 * Git greys out rather than vanishing. Staging is its own activity and keeps
 * its own tab whether or not this comparison can reach a working tree — a tab
 * that comes and goes with the head moves the row of tabs under the cursor and
 * leaves no way to tell "nothing to stage" from "where did that go". Review is
 * the one that is still withheld, because with no comparison at all it is not
 * empty, it is meaningless.
 */
export function visibleFilesPanelTabs(
  comparison: Comparison | null,
  gitEnabled: boolean,
): FilesPanelTabState[] {
  return FILES_PANEL_TABS.filter(
    (tab) => tab.id !== "changes" || comparison,
  ).map((tab) =>
    tab.id === "git" && !gitEnabled
      ? {
          ...tab,
          disabled: true,
          disabledReason: comparison
            ? `${refLabel(comparison.head)} isn't checked out`
            : "Nothing here is checked out",
        }
      : { ...tab, disabled: false },
  );
}
