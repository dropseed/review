import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useLiveSessionsByReviewKey } from "../../stores/selectors/terminals";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { terminalSeverity } from "../../stores/slices/terminalSlice";
import { makeReviewKey } from "../../utils/review-key";
import {
  activateSidebarRow,
  terminalSidebarRows,
  type SidebarRow,
} from "../../utils/sidebar-tree";
import { Rail, RailButton, RailSeparator, RailTab } from "../ui/rail";
import { SidebarPanelIcon } from "../ui/icons";
import { AgentUsageRail } from "../AgentUsageIndicator";
import { PhaseDot } from "./PhaseDot";
import { basename, phaseSummary } from "./terminal-status-format";
import { primaryStatus } from "../Terminal/glance";
import { TerminalGlanceCard } from "../Terminal/TerminalGlanceCard";
import type {
  GlobalReviewSummary,
  TerminalStatus,
  ViewerPr,
} from "../../types";

interface SidebarRailProps {
  onExpand: () => void;
  onActivateReview: (review: GlobalReviewSummary) => void;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
  /**
   * Threaded through for completeness rather than reachability: the rail shows
   * only rows with a shell running in them, and a PR with nothing checked out
   * can't host one. Passing it keeps `activateSidebarRow` exhaustive, so a new
   * row kind is a compile error here rather than a silent dead click.
   */
  onActivateOpenPr: (pr: ViewerPr) => void;
}

/**
 * The sidebar's collapsed state — the same rule the terminal panel follows:
 * hiding a pane leaves a strip on its edge, not nothing. Collapsing used to
 * drop the sidebar to zero width and float a lone toggle over the content,
 * which read as a stray button in dead space.
 *
 * What it carries is what survives losing the labels: every row with a shell
 * running in it. They're jump targets — collapsed is meant to still be a way to
 * move between the things you're working on, not just a button that undoes
 * itself.
 */
export function SidebarRail({
  onExpand,
  onActivateReview,
  onActivateLocalBranch,
  onActivateOpenPr,
}: SidebarRailProps): ReactNode {
  const tree = useSidebarTree();
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const liveSessions = useLiveSessionsByReviewKey();

  // "Has a shell running in it" is already a liveness reason the tree
  // computed — asking it again here would be a second copy of the rule.
  const busyRows = terminalSidebarRows(tree);

  const activeKey = activeReviewKey
    ? makeReviewKey(activeReviewKey.repoPath, activeReviewKey.ref)
    : null;

  const activate = (row: SidebarRow): void =>
    activateSidebarRow(row, {
      onActivateReview,
      onActivateLocalBranch,
      onActivateOpenPr,
    });

  const renderRow = (row: SidebarRow): ReactNode => {
    const ids = liveSessions[row.reviewKey] ?? [];
    const statuses = ids
      .map((id) => terminalStatuses[id])
      .filter((s): s is TerminalStatus => s != null);
    const phase = terminalSeverity(statuses);
    const label = phase
      ? `${basename(row.repoPath)} — ${row.ref} · ${ids.length} terminal${
          ids.length === 1 ? "" : "s"
        }, ${phaseSummary(phase, statuses)}`
      : `${basename(row.repoPath)} — ${row.ref}`;
    // The row's loudest shell, peeked on hover — the collapsed sidebar's way
    // of answering "what is that dot about" without expanding anything.
    const primary = primaryStatus(statuses);

    return (
      <RailTab
        key={row.reviewKey}
        text={row.ref}
        label={label}
        edge="left"
        active={row.reviewKey === activeKey}
        onClick={() => activate(row)}
        marker={phase ? <PhaseDot phase={phase} /> : undefined}
        rich={
          primary ? <TerminalGlanceCard sessionId={primary.id} /> : undefined
        }
      />
    );
  };

  return (
    <Rail className="w-9 shrink-0 border-r border-edge bg-surface">
      <RailButton label="Show sidebar (⌘B)" edge="left" onClick={onExpand}>
        <SidebarPanelIcon className="h-3.5 w-3.5" />
      </RailButton>

      {busyRows.length > 0 && <RailSeparator />}

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {busyRows.map(renderRow)}
      </div>

      {/* Where the usage rows sit when the sidebar is open — kept at the foot
          rather than dropped, since how much of the week is left is exactly
          the kind of thing you want without expanding anything. */}
      <AgentUsageRail edge="left" />
    </Rail>
  );
}
