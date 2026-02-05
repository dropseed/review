import { SimpleTooltip } from "../ui/tooltip";
import type { FileHunkStatus } from "./types";

// Symlink indicator with arrow icon and tooltip
export function SymlinkIndicator({ target }: { target?: string }) {
  return (
    <SimpleTooltip content={target ? `Symlink \u2192 ${target}` : "Symlink"}>
      <span className="flex-shrink-0 text-stone-500">
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

// Git status configuration
export const STATUS_CONFIG: Record<string, { letter: string; color: string }> =
  {
    added: { letter: "A", color: "text-emerald-400" },
    modified: { letter: "M", color: "text-amber-400" },
    deleted: { letter: "D", color: "text-rose-400" },
    renamed: { letter: "R", color: "text-sky-400" },
    untracked: { letter: "U", color: "text-emerald-400" },
  };

// Hunk count indicator - context-aware
// "needs-review": shows pending count
// "reviewed": shows reviewed count
// "all": shows reviewed/total
export function HunkCount({
  status,
  context,
}: {
  status: FileHunkStatus;
  context: "needs-review" | "reviewed" | "all";
}) {
  if (status.total === 0) return null;

  const reviewed = status.approved + status.trusted + status.rejected;

  if (context === "needs-review") {
    // Show pending count
    return (
      <span className="font-mono text-xxs tabular-nums text-stone-500">
        {status.pending}
      </span>
    );
  }

  if (context === "reviewed") {
    // Show reviewed count
    return (
      <span className="font-mono text-xxs tabular-nums text-emerald-500">
        {reviewed}
      </span>
    );
  }

  // "all" context - show reviewed/total
  const isComplete = status.pending === 0;
  return (
    <span
      className={`font-mono text-xxs tabular-nums ${isComplete ? "text-emerald-500" : "text-stone-500"}`}
    >
      {reviewed}/{status.total}
    </span>
  );
}

// Status letter indicator
export function StatusLetter({ status }: { status?: string }) {
  const config = status ? STATUS_CONFIG[status] : null;

  if (!config) {
    // Unchanged file - show dim dot
    return (
      <span className="w-3 text-center font-mono text-xxs text-stone-500">
        ·
      </span>
    );
  }

  return (
    <span
      className={`w-3 text-center font-mono text-xxs font-medium ${config.color}`}
    >
      {config.letter}
    </span>
  );
}
