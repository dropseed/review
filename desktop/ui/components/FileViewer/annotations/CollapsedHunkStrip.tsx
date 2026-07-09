import type { DiffHunk } from "../../../types";

interface CollapsedHunkStripProps {
  hunk: DiffHunk;
  /** e.g. "hunk from 4fbf33c5 Add team references…" or "uncommitted hunk". */
  label: string;
  onExpand: () => void;
}

/**
 * Stand-in for a hunk's action panel when it falls outside the active
 * review scope (e.g. a commit filter). Keeps the hunk reachable — click to
 * reveal the normal panel — without competing for attention with in-scope
 * hunks.
 */
export function CollapsedHunkStrip({
  hunk,
  label,
  onExpand,
}: CollapsedHunkStripProps) {
  return (
    <button
      type="button"
      data-hunk-id={hunk.id}
      onClick={onExpand}
      className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-edge-default/40 px-3 py-1 mx-2 my-1 text-left text-xxs italic text-fg-faint transition-colors hover:border-edge-default/70 hover:text-fg-muted"
    >
      <svg
        className="h-2.5 w-2.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
      </svg>
      <span className="truncate">{label}</span>
    </button>
  );
}
