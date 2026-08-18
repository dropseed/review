import type { ReactNode } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import type { FileHunkStatus } from "./types";

export function fileNameColor(
  isSelected: boolean,
  isGitignored: boolean,
  status?: string,
): string {
  const deleted = status === "deleted" ? "line-through " : "";
  if (isSelected) return `${deleted}text-fg`;
  if (isGitignored) return `${deleted}text-fg-muted`;
  if (status === "deleted") return "line-through text-status-deleted";
  if (status === "added" || status === "untracked") return "text-status-added";
  return "text-fg-secondary";
}

export function SymlinkIndicator({ target }: { target?: string }): ReactNode {
  return (
    <SimpleTooltip content={target ? `Symlink \u2192 ${target}` : "Symlink"}>
      <span className="flex-shrink-0 text-fg-muted">
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
      </span>
    </SimpleTooltip>
  );
}

export function HunkCount({
  status,
  context,
  hideOnHover = false,
}: {
  status: FileHunkStatus;
  context: "needs-review" | "reviewed" | "trusted" | "all";
  hideOnHover?: boolean;
}): ReactNode {
  if (status.total === 0) return null;

  const reviewed = status.approved + status.trusted + status.rejected;
  const hoverClass = hideOnHover ? "group-hover:hidden" : "";

  // Inside a status section (needs-review/reviewed/trusted) the section
  // header already carries the color for that bucket — a row just reports
  // its size, dim and uncolored, so the tree doesn't shout at every level.
  // Trusted is its own section, so "reviewed" counts only explicit human
  // decisions, approved and rejected alike.
  if (context !== "all") {
    const count =
      context === "needs-review"
        ? status.pending
        : context === "trusted"
          ? status.trusted
          : status.approved + status.rejected;
    // needs-review states its zero — an empty queue is the goal, not noise.
    if (count === 0 && context !== "needs-review") return null;
    return (
      <span
        className={`font-mono text-xxs tabular-nums text-fg-muted ${hoverClass}`}
      >
        {count}
      </span>
    );
  }

  const isComplete = status.pending === 0;
  return (
    <span
      className={`font-mono text-xxs tabular-nums ${hoverClass} ${isComplete ? "text-status-approved" : "text-fg-muted"}`}
    >
      {reviewed}/{status.total}
    </span>
  );
}

const WORKING_TREE_DOT_COLORS: Record<string, string> = {
  staged: "bg-status-added",
  unstaged: "bg-status-modified",
  untracked: "bg-fg-muted",
};

export function WorkingTreeDot({
  status,
  hideOnHover = false,
}: {
  status: string;
  hideOnHover?: boolean;
}): ReactNode {
  const color = WORKING_TREE_DOT_COLORS[status] ?? "bg-fg-muted";
  const hoverClass = hideOnHover ? "group-hover:hidden" : "";
  return (
    <SimpleTooltip content={status}>
      <span
        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${hoverClass} ${color}`}
      />
    </SimpleTooltip>
  );
}
