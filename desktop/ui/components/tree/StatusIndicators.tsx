import type { ReactNode } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import type { FileHunkStatus } from "./types";

const STATUS_CONFIG: Record<string, { letter: string; color: string }> = {
  added: { letter: "A", color: "text-status-added" },
  modified: { letter: "M", color: "text-status-modified" },
  deleted: { letter: "D", color: "text-status-deleted" },
  renamed: { letter: "R", color: "text-status-renamed" },
  copied: { letter: "C", color: "text-status-renamed" },
  untracked: { letter: "U", color: "text-status-untracked" },
};

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
  context: "needs-review" | "reviewed" | "all";
  hideOnHover?: boolean;
}): ReactNode {
  if (status.total === 0) return null;

  const reviewed = status.approved + status.trusted + status.rejected;
  const hoverClass = hideOnHover ? "group-hover:hidden" : "";

  if (context === "needs-review") {
    return (
      <span
        className={`font-mono text-xxs tabular-nums text-fg-muted ${hoverClass}`}
      >
        {status.pending}
      </span>
    );
  }

  if (context === "reviewed") {
    // Show individual color-coded counts for each status
    const segments: { count: number; color: string }[] = [];
    if (status.trusted > 0)
      segments.push({ count: status.trusted, color: "text-status-trusted" });
    if (status.approved > 0)
      segments.push({ count: status.approved, color: "text-status-approved" });
    if (status.rejected > 0)
      segments.push({ count: status.rejected, color: "text-status-rejected" });

    if (segments.length === 0) return null;

    // Single status — just show the number
    if (segments.length === 1) {
      return (
        <span
          className={`font-mono text-xxs tabular-nums ${hoverClass} ${segments[0].color}`}
        >
          {segments[0].count}
        </span>
      );
    }

    // Multiple statuses — show each count in its color separated by ·
    return (
      <span
        className={`font-mono text-xxs tabular-nums inline-flex items-center ${hoverClass}`}
      >
        {segments.map((seg, i) => (
          <span key={i} className="inline-flex items-center">
            {i > 0 && <span className="text-fg-faint mx-px">·</span>}
            <span className={seg.color}>{seg.count}</span>
          </span>
        ))}
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

export function StatusLetter({
  status,
  hideOnHover = false,
}: {
  status?: string;
  hideOnHover?: boolean;
}): ReactNode {
  const config = status ? STATUS_CONFIG[status] : null;
  if (!config) {
    return null;
  }

  const hoverClass = hideOnHover ? "group-hover:hidden" : "";
  return (
    <span
      className={`w-5 text-center font-mono text-xxs font-medium ${hoverClass} ${config.color}`}
    >
      {config.letter}
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
