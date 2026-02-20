import type { MutableRefObject, ReactNode } from "react";
import type { DiffHunk } from "../../../types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";
import { SimpleTooltip } from "../../ui/tooltip";

interface WorkingTreeHunkPanelProps {
  hunk: DiffHunk;
  focusedHunkId: string | null | undefined;
  focusedHunkRef: MutableRefObject<HTMLDivElement | null>;
  hunkPosition?: number;
  totalHunksInFile?: number;
  mode: "staged" | "unstaged";
  onStage: (contentHash: string) => void;
  onUnstage: (contentHash: string) => void;
  onCopyHunk: (hunk: DiffHunk) => void;
  onViewInFile?: (line: number) => void;
}

export function WorkingTreeHunkPanel({
  hunk,
  focusedHunkId,
  focusedHunkRef,
  hunkPosition,
  totalHunksInFile,
  mode,
  onStage,
  onUnstage,
  onCopyHunk,
  onViewInFile,
}: WorkingTreeHunkPanelProps): ReactNode {
  const isFocused = hunk.id === focusedHunkId;

  const borderClass = isFocused
    ? "border border-edge-strong/60 ring-1 ring-fg/25"
    : "border border-edge-default/40";

  return (
    <div
      data-hunk-id={hunk.id}
      ref={isFocused ? focusedHunkRef : undefined}
      className={`@container flex items-center gap-2 overflow-x-auto px-3 py-1.5 mx-2 my-1.5 rounded-lg shadow-depth transition-[border-color,box-shadow] duration-150 ${borderClass} bg-surface-raised/90`}
    >
      {/* Primary action: Stage or Unstage */}
      {mode === "unstaged" ? (
        <SimpleTooltip content="Stage this hunk">
          <button
            onClick={() => onStage(hunk.contentHash)}
            className="flex items-center gap-1.5 rounded-md bg-status-approved/10 px-2.5 py-1 text-xs font-medium text-status-approved transition-colors hover:bg-status-approved/20 active:scale-95"
            aria-label="Stage hunk"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            <span className="hidden @md:inline">Stage</span>
          </button>
        </SimpleTooltip>
      ) : (
        <SimpleTooltip content="Unstage this hunk">
          <button
            onClick={() => onUnstage(hunk.contentHash)}
            className="flex items-center gap-1.5 rounded-md bg-status-modified/10 px-2.5 py-1 text-xs font-medium text-status-modified transition-colors hover:bg-status-modified/20 active:scale-95"
            aria-label="Unstage hunk"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 12h-15"
              />
            </svg>
            <span className="hidden @md:inline">Unstage</span>
          </button>
        </SimpleTooltip>
      )}

      {/* Right side: overflow menu + position */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg-secondary transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring/50"
              aria-label="More options"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onViewInFile && (
              <DropdownMenuItem
                onClick={() => {
                  const firstChanged = hunk.lines.find(
                    (l) => l.type === "added" || l.type === "removed",
                  );
                  const targetLine =
                    firstChanged?.newLineNumber ?? hunk.newStart;
                  onViewInFile(targetLine);
                }}
              >
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                View in file
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onCopyHunk(hunk)}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy hunk
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Hunk position with j/k hints */}
        {hunkPosition !== undefined &&
          totalHunksInFile !== undefined &&
          totalHunksInFile > 1 && (
            <div className="flex items-center gap-1 text-fg-faint select-none">
              {isFocused && <kbd className="text-fg-faint">k</kbd>}
              <span className="text-xxs tabular-nums">
                {hunkPosition}/{totalHunksInFile}
              </span>
              {isFocused && <kbd className="text-fg-faint">j</kbd>}
            </div>
          )}
      </div>
    </div>
  );
}
