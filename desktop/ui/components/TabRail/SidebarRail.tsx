import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useLiveSessionsByReviewKey } from "../../stores/selectors/terminals";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { terminalSeverity } from "../../stores/slices/terminalSlice";
import { makeReviewKey } from "../../utils/review-key";
import type { SidebarRow } from "../../utils/sidebar-tree";
import { Rail, RailButton, RailSeparator, RailTab } from "../ui/rail";
import { SidebarPanelIcon } from "../ui/icons";
import { PhaseDot } from "./PhaseDot";
import { basename, phaseLabel } from "./terminal-status-format";
import type { GlobalReviewSummary, TerminalStatus } from "../../types";

interface SidebarRailProps {
  onExpand: () => void;
  onActivateReview: (review: GlobalReviewSummary) => void;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}

/**
 * The sidebar's collapsed state — the same rule the terminal panel follows:
 * hiding a pane leaves a strip on its edge, not nothing. Collapsing used to
 * drop the sidebar to zero width and float a lone toggle over the content,
 * which read as a stray button in dead space.
 *
 * What it carries is what survives losing the labels: the rows you pinned, in
 * your order, and any row with a shell running in it. Both are jump targets —
 * collapsed is meant to still be a way to move between the things you're
 * working on, not just a button that undoes itself.
 */
export function SidebarRail({
  onExpand,
  onActivateReview,
  onActivateLocalBranch,
}: SidebarRailProps): ReactNode {
  const tree = useSidebarTree();
  const sidebarPinned = useReviewStore((s) => s.sidebarPinned);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const liveSessions = useLiveSessionsByReviewKey();

  const rows = tree.flatMap((node) =>
    [node.head, ...node.live, ...node.rest].filter(
      (row): row is SidebarRow => row != null,
    ),
  );
  const byKey = new Map(rows.map((row) => [row.reviewKey, row]));

  // Pin order is the user's own ordering, so it isn't re-sorted here.
  const pinnedRows = sidebarPinned
    .map((key) => byKey.get(key))
    .filter((row): row is SidebarRow => row != null);

  // "Has a shell running in it" is already a liveness reason the tree
  // computed — asking it again here would be a second copy of the rule.
  const pinnedKeys = new Set(pinnedRows.map((row) => row.reviewKey));
  const busyRows = rows.filter(
    (row) => !pinnedKeys.has(row.reviewKey) && row.reasons.includes("terminal"),
  );

  const activeKey = activeReviewKey
    ? makeReviewKey(activeReviewKey.repoPath, activeReviewKey.ref)
    : null;

  const activate = (row: SidebarRow): void => {
    const { entry } = row;
    if (entry.kind === "review") {
      onActivateReview(entry.review);
    } else if (entry.kind === "remote-recent") {
      onActivateLocalBranch(
        entry.repoPath,
        entry.branchName,
        entry.defaultBranch,
      );
    } else {
      onActivateLocalBranch(
        row.repoPath,
        entry.branch.name,
        entry.repo.defaultBranch,
      );
    }
  };

  const renderRow = (row: SidebarRow): ReactNode => {
    const ids = liveSessions[row.reviewKey] ?? [];
    const statuses = ids
      .map((id) => terminalStatuses[id])
      .filter((s): s is TerminalStatus => s != null);
    const phase = terminalSeverity(statuses);
    const label = phase
      ? `${basename(row.repoPath)} — ${row.ref} · ${ids.length} terminal${
          ids.length === 1 ? "" : "s"
        }, ${phaseLabel(phase)}`
      : `${basename(row.repoPath)} — ${row.ref}`;

    return (
      <RailTab
        key={row.reviewKey}
        text={row.ref}
        label={label}
        edge="left"
        active={row.reviewKey === activeKey}
        onClick={() => activate(row)}
        marker={phase ? <PhaseDot phase={phase} /> : undefined}
      />
    );
  };

  return (
    <Rail className="w-9 shrink-0 border-r border-edge bg-surface">
      <RailButton label="Show sidebar (⌘B)" edge="left" onClick={onExpand}>
        <SidebarPanelIcon className="h-3.5 w-3.5" />
      </RailButton>

      {(pinnedRows.length > 0 || busyRows.length > 0) && <RailSeparator />}

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {pinnedRows.map(renderRow)}
        {/* Unpinned, but something is running there — the rail's own reason to
            interrupt you, kept below the list you curated. */}
        {busyRows.length > 0 && pinnedRows.length > 0 && (
          <RailSeparator className="w-3 bg-edge/40" />
        )}
        {busyRows.map(renderRow)}
      </div>
    </Rail>
  );
}
