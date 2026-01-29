import { memo } from "react";
import { getPlatformServices } from "../../platform";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/context-menu";
import { SimpleTooltip } from "../ui/tooltip";
import type { ProcessedFileEntry } from "./types";
import { HunkCount, StatusLetter } from "./StatusIndicators";

export type HunkContext = "needs-review" | "reviewed" | "all";

interface FileNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  repoPath: string | null;
  revealLabel: string;
  onOpenInSplit?: (path: string) => void;
  registerRef: (path: string, ref: HTMLButtonElement | null) => void;
  hunkContext: HunkContext;
  onApproveAll?: (path: string, isDir: boolean) => void;
  onUnapproveAll?: (path: string, isDir: boolean) => void;
}

// Approve/Unapprove buttons that show on hover
function ApprovalButtons({
  hasPending,
  hasApproved,
  onApprove,
  onUnapprove,
}: {
  hasPending: boolean;
  hasApproved: boolean;
  onApprove: () => void;
  onUnapprove: () => void;
}) {
  if (!hasPending && !hasApproved) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      {/* Approve button - show if there are pending hunks */}
      {hasPending && (
        <SimpleTooltip content="Approve all">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            className="flex items-center justify-center w-5 h-5 rounded
                       text-stone-500 hover:text-lime-400 hover:bg-lime-500/20
                       transition-colors"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
        </SimpleTooltip>
      )}

      {/* Unapprove button - show if there are approved hunks */}
      {hasApproved && (
        <SimpleTooltip content="Unapprove all">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnapprove();
            }}
            className="flex items-center justify-center w-5 h-5 rounded
                       text-lime-400 hover:text-stone-400 hover:bg-stone-700/50
                       transition-colors"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
              />
            </svg>
          </button>
        </SimpleTooltip>
      )}
    </div>
  );
}

export const FileNode = memo(
  function FileNode({
    entry,
    depth,
    expandedPaths,
    onToggle,
    selectedFile,
    onSelectFile,
    repoPath,
    revealLabel,
    onOpenInSplit,
    registerRef,
    hunkContext,
    onApproveAll,
    onUnapproveAll,
  }: FileNodeProps) {
    if (!entry.matchesFilter) {
      return null;
    }

    const isExpanded = expandedPaths.has(entry.path);
    const isSelected = selectedFile === entry.path;
    // Use rem for scaling: base 0.5rem + 0.8rem per depth level
    const paddingLeft = `${depth * 0.8 + 0.5}rem`;

    if (entry.isDirectory) {
      const visibleChildren = entry.children?.filter((c) => c.matchesFilter);
      const isGitignored = entry.status === "gitignored";
      const hasReviewableContent = entry.hunkStatus.total > 0;
      const hasPending = entry.hunkStatus.pending > 0;
      const hasApproved = entry.hunkStatus.approved > 0;

      const barPct =
        hunkContext === "all" && entry.siblingMaxFileCount > 0
          ? (entry.fileCount / entry.siblingMaxFileCount) * 100
          : 0;

      return (
        <div className="select-none">
          <div
            className={`group flex w-full items-center gap-1.5 py-0.5 pr-2 transition-colors ${
              isGitignored
                ? "opacity-50 hover:opacity-70"
                : "hover:bg-stone-800/40"
            }`}
            style={{ paddingLeft }}
          >
            <button
              className="flex flex-1 items-center gap-1.5 text-left min-w-0"
              onClick={() => onToggle(entry.path)}
              aria-expanded={isExpanded}
            >
              {/* Chevron */}
              <svg
                className={`h-3 w-3 flex-shrink-0 text-stone-600 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M10 6l6 6-6 6" />
              </svg>

              {/* Directory name */}
              <span
                className={`min-w-0 flex-1 truncate text-xs ${isGitignored ? "text-stone-500" : "text-stone-200"}`}
              >
                {entry.displayName}
              </span>
            </button>

            {/* Relative size bar + file count on hover (Browse only) */}
            {barPct > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="font-mono text-xxs tabular-nums text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  {entry.fileCount}
                </span>
                <div className="w-12 flex justify-end">
                  <div
                    className="h-1 rounded-full bg-stone-600"
                    style={{ width: `${Math.max(barPct, 10)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Approval button */}
            {onApproveAll && onUnapproveAll && hasReviewableContent && (
              <ApprovalButtons
                hasPending={hasPending}
                hasApproved={hasApproved}
                onApprove={() => onApproveAll(entry.path, true)}
                onUnapprove={() => onUnapproveAll(entry.path, true)}
              />
            )}

            {/* Aggregate hunk count (hidden in Browse mode) */}
            {hunkContext !== "all" && (
              <HunkCount status={entry.hunkStatus} context={hunkContext} />
            )}
          </div>

          {isExpanded && visibleChildren && visibleChildren.length > 0 && (
            <div>
              {visibleChildren.map((child) => (
                <FileNode
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  repoPath={repoPath}
                  revealLabel={revealLabel}
                  onOpenInSplit={onOpenInSplit}
                  registerRef={registerRef}
                  hunkContext={hunkContext}
                  onApproveAll={onApproveAll}
                  onUnapproveAll={onUnapproveAll}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    // File node
    const isGitignored = entry.status === "gitignored";
    const hasReviewableContent = entry.hunkStatus.total > 0;
    const hasPending = entry.hunkStatus.pending > 0;
    const hasApproved = entry.hunkStatus.approved > 0;
    const isComplete = hasReviewableContent && entry.hunkStatus.pending === 0;
    const fullPath = repoPath ? `${repoPath}/${entry.path}` : entry.path;

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={(el) =>
              registerRef(entry.path, el as HTMLButtonElement | null)
            }
            className={`group flex w-full items-center gap-1.5 py-0.5 pr-2 transition-colors ${
              isSelected
                ? "bg-amber-500/15 border-l-2 border-l-amber-400"
                : isGitignored
                  ? "border-l-2 border-l-transparent opacity-50 hover:opacity-70"
                  : "border-l-2 border-l-transparent hover:bg-stone-800/40"
            }`}
            style={{ paddingLeft: `${depth * 0.8 + 0.5}rem` }}
          >
            <button
              className="flex flex-1 items-center gap-1.5 text-left min-w-0"
              onClick={() => onSelectFile(entry.path)}
              aria-selected={isSelected}
            >
              {/* Git status */}
              <StatusLetter status={entry.status} />

              {/* File name */}
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  isSelected
                    ? "text-stone-100"
                    : isComplete
                      ? "text-lime-400"
                      : isGitignored
                        ? "text-stone-500"
                        : "text-stone-300"
                }`}
              >
                {entry.name}
              </span>
            </button>

            {/* Approval button */}
            {onApproveAll && onUnapproveAll && hasReviewableContent && (
              <ApprovalButtons
                hasPending={hasPending}
                hasApproved={hasApproved}
                onApprove={() => onApproveAll(entry.path, false)}
                onUnapprove={() => onUnapproveAll(entry.path, false)}
              />
            )}

            {/* Hunk count (hidden in Browse mode) */}
            {hunkContext !== "all" && (
              <HunkCount status={entry.hunkStatus} context={hunkContext} />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {onOpenInSplit && (
            <>
              <ContextMenuItem onSelect={() => onOpenInSplit(entry.path)}>
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 4v16M15 4v16"
                  />
                </svg>
                Open in Split View
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onSelect={async () => {
              const platform = getPlatformServices();
              await platform.opener.openUrl(`vscode://file${fullPath}`);
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
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Open in VS Code
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={async () => {
              const platform = getPlatformServices();
              await platform.clipboard.writeText(fullPath);
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
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Copy Path
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={async () => {
              const platform = getPlatformServices();
              await platform.opener.revealItemInDir(fullPath);
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
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            {revealLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  },
  (prev, next) => {
    return (
      prev.entry === next.entry &&
      prev.depth === next.depth &&
      prev.expandedPaths === next.expandedPaths &&
      prev.selectedFile === next.selectedFile &&
      prev.hunkContext === next.hunkContext &&
      prev.onApproveAll === next.onApproveAll &&
      prev.onUnapproveAll === next.onUnapproveAll &&
      prev.repoPath === next.repoPath &&
      prev.revealLabel === next.revealLabel &&
      prev.onOpenInSplit === next.onOpenInSplit
    );
  },
);
