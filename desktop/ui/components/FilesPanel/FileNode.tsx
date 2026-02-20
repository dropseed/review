import { memo, type ReactNode } from "react";
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
import {
  TreeNodeItem,
  TreeRow,
  TreeRowButton,
  TreeChevron,
  TreeNodeName,
  StatusLetter,
  SymlinkIndicator,
  TreeFileIcon,
  WorkingTreeDot,
} from "../tree";
import { NodeOverflowMenu } from "./NodeOverflowMenu";

export type HunkContext = "needs-review" | "reviewed" | "all";

function directoryNameColor(isGitignored: boolean): string {
  if (isGitignored) return "text-fg-muted";
  return "text-fg-secondary";
}

function fileNameColor(isSelected: boolean, isGitignored: boolean): string {
  if (isSelected) return "text-fg";
  if (isGitignored) return "text-fg-muted";
  return "text-fg-secondary";
}

interface FileNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string, isGitignored?: boolean) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  repoPath: string | null;
  revealLabel: string;
  onOpenInSplit?: (path: string) => void;
  registerRef: (path: string, ref: HTMLButtonElement | null) => void;
  hunkContext: HunkContext;
  onApproveAll?: (path: string, isDir: boolean) => void;
  onUnapproveAll?: (path: string, isDir: boolean) => void;
  onRejectAll?: (path: string, isDir: boolean) => void;
  movedFilePaths?: Set<string>;
  onStage?: (path: string, isDir: boolean) => void;
  onUnstage?: (path: string, isDir: boolean) => void;
  workingTreeStatusMap?: Map<string, string>;
  collapsible?: boolean;
  showSizeBar?: boolean;
}

interface ApprovalButtonsProps {
  hasPending: boolean;
  hasApproved: boolean;
  onApprove: () => void;
  onUnapprove: () => void;
}

export function ApprovalButtons({
  hasPending,
  hasApproved,
  onApprove,
  onUnapprove,
}: ApprovalButtonsProps): ReactNode {
  if (!hasPending && !hasApproved) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      {hasPending && (
        <SimpleTooltip content="Approve all">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            className="flex items-center justify-center w-5 h-5 rounded
                       text-fg-muted hover:text-status-approved hover:bg-status-approved/20
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
      {hasApproved && (
        <SimpleTooltip content="Unapprove all">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnapprove();
            }}
            className="flex items-center justify-center w-5 h-5 rounded
                       text-status-approved hover:text-fg-muted hover:bg-surface-hover/50
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

interface StageButtonsProps {
  onStage?: () => void;
  onUnstage?: () => void;
}

export function StageButtons({
  onStage,
  onUnstage,
}: StageButtonsProps): ReactNode {
  if (!onStage && !onUnstage) return null;

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      {onStage && (
        <SimpleTooltip content="Stage">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStage();
            }}
            className="flex items-center justify-center w-5 h-5 rounded
                       text-fg-muted hover:text-status-approved hover:bg-status-approved/20
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
                d="M12 4v16m-8-8h16"
              />
            </svg>
          </button>
        </SimpleTooltip>
      )}
      {onUnstage && (
        <SimpleTooltip content="Unstage">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnstage();
            }}
            className="flex items-center justify-center w-5 h-5 rounded
                       text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50
                       transition-colors"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />
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
    onRejectAll,
    movedFilePaths,
    onStage,
    onUnstage,
    workingTreeStatusMap,
    collapsible = true,
    showSizeBar = false,
  }: FileNodeProps) {
    if (!entry.matchesFilter) {
      return null;
    }

    const isExpanded = !collapsible || expandedPaths.has(entry.path);
    const isSelected = selectedFile === entry.path;

    if (entry.isDirectory) {
      const visibleChildren = entry.children?.filter((c) => c.matchesFilter);
      const isGitignored = entry.status === "gitignored";
      const hasReviewableContent = entry.hunkStatus.total > 0;
      const hasPending = entry.hunkStatus.pending > 0;
      const hasApproved = entry.hunkStatus.approved > 0;
      const dirHasRejections = entry.hunkStatus.rejected > 0;
      // Symlink directories pointing outside repo need lazy loading like gitignored dirs
      const needsLazyLoad = isGitignored || entry.isSymlink;
      const hasReviewActions = !!(
        onApproveAll &&
        onUnapproveAll &&
        onRejectAll
      );

      const barPct =
        showSizeBar && entry.siblingMaxFileCount > 0
          ? (entry.fileCount / entry.siblingMaxFileCount) * 100
          : 0;

      return (
        <TreeNodeItem>
          <TreeRow
            depth={depth}
            className={
              isGitignored
                ? "opacity-50 hover:opacity-70"
                : "hover:bg-surface-raised/40"
            }
          >
            <TreeRowButton
              onClick={
                collapsible
                  ? () => onToggle(entry.path, needsLazyLoad)
                  : undefined
              }
              aria-expanded={collapsible ? isExpanded : undefined}
            >
              {collapsible && <TreeChevron expanded={isExpanded} />}

              <TreeNodeName className={directoryNameColor(isGitignored)}>
                {entry.displayName}
              </TreeNodeName>

              {entry.isSymlink && (
                <SymlinkIndicator target={entry.symlinkTarget} />
              )}
            </TreeRowButton>

            {barPct > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="font-mono text-xxs tabular-nums text-fg-faint opacity-0 group-hover:opacity-100 transition-opacity">
                  {entry.fileCount}
                </span>
                <div className="w-12 flex justify-end">
                  <div
                    className="h-1 rounded-full bg-surface-active"
                    style={{ width: `${Math.max(barPct, 10)}%` }}
                  />
                </div>
              </div>
            )}

            {hasReviewActions && hasReviewableContent && (
              <ApprovalButtons
                hasPending={hasPending}
                hasApproved={hasApproved}
                onApprove={() => onApproveAll!(entry.path, true)}
                onUnapprove={() => onUnapproveAll!(entry.path, true)}
              />
            )}

            {hasReviewActions && hasReviewableContent && (
              <NodeOverflowMenu
                path={entry.path}
                isDirectory
                hasPending={hasPending}
                hasApproved={hasApproved}
                hasRejected={dirHasRejections}
                onApproveAll={() => onApproveAll!(entry.path, true)}
                onRejectAll={() => onRejectAll!(entry.path, true)}
                onUnapproveAll={() => onUnapproveAll!(entry.path, true)}
              />
            )}

            {(onStage || onUnstage) && (
              <StageButtons
                onStage={onStage ? () => onStage(entry.path, true) : undefined}
                onUnstage={
                  onUnstage ? () => onUnstage(entry.path, true) : undefined
                }
              />
            )}

            {entry.renamedFrom && (
              <SimpleTooltip content={`Moved from ${entry.renamedFrom}`}>
                <span className="flex-shrink-0 rounded bg-status-renamed/15 px-1 py-0.5 text-xxs font-medium text-status-renamed">
                  Moved
                </span>
              </SimpleTooltip>
            )}

            {entry.status && !isGitignored && (
              <StatusLetter
                status={entry.status}
                hideOnHover={
                  (hasReviewActions && hasReviewableContent) ||
                  !!onStage ||
                  !!onUnstage
                }
              />
            )}
          </TreeRow>

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
                  onRejectAll={onRejectAll}
                  movedFilePaths={movedFilePaths}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  workingTreeStatusMap={workingTreeStatusMap}
                  collapsible={collapsible}
                  showSizeBar={showSizeBar}
                />
              ))}
            </div>
          )}
        </TreeNodeItem>
      );
    }

    // File node
    const isGitignored = entry.status === "gitignored";
    const hasReviewableContent = entry.hunkStatus.total > 0;
    const hasPending = entry.hunkStatus.pending > 0;
    const hasApproved = entry.hunkStatus.approved > 0;
    const hasRejections = entry.hunkStatus.rejected > 0;
    const hasReviewActions = !!(onApproveAll && onUnapproveAll && onRejectAll);
    const fullPath = repoPath ? `${repoPath}/${entry.path}` : entry.path;

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TreeRow
            ref={(el) =>
              registerRef(entry.path, el as unknown as HTMLButtonElement | null)
            }
            depth={depth}
            className={
              isSelected
                ? "bg-status-modified/15 border-l-2 border-l-status-modified"
                : isGitignored
                  ? "border-l-2 border-l-transparent opacity-50 hover:opacity-70"
                  : "border-l-2 border-l-transparent hover:bg-surface-raised/40"
            }
          >
            <TreeRowButton
              onClick={() => onSelectFile(entry.path)}
              aria-selected={isSelected}
            >
              <TreeFileIcon name={entry.name} isDirectory={false} />

              <TreeNodeName className={fileNameColor(isSelected, isGitignored)}>
                {entry.name}
              </TreeNodeName>

              {movedFilePaths?.has(entry.path) && (
                <span className="flex-shrink-0 rounded bg-status-renamed/15 px-1 py-0.5 text-xxs font-medium text-status-renamed">
                  Moved
                </span>
              )}

              {entry.isSymlink && (
                <SymlinkIndicator target={entry.symlinkTarget} />
              )}
            </TreeRowButton>

            {hasReviewActions && hasReviewableContent && (
              <ApprovalButtons
                hasPending={hasPending}
                hasApproved={hasApproved}
                onApprove={() => onApproveAll!(entry.path, false)}
                onUnapprove={() => onUnapproveAll!(entry.path, false)}
              />
            )}

            {hasReviewActions && (
              <NodeOverflowMenu
                path={entry.path}
                isDirectory={false}
                hasPending={hasPending}
                hasApproved={hasApproved}
                hasRejected={hasRejections}
                onApproveAll={() => onApproveAll!(entry.path, false)}
                onRejectAll={() => onRejectAll!(entry.path, false)}
                onUnapproveAll={() => onUnapproveAll!(entry.path, false)}
                onOpenInSplit={onOpenInSplit}
                revealLabel={revealLabel}
              />
            )}

            {(onStage || onUnstage) && (
              <StageButtons
                onStage={onStage ? () => onStage(entry.path, false) : undefined}
                onUnstage={
                  onUnstage ? () => onUnstage(entry.path, false) : undefined
                }
              />
            )}

            {workingTreeStatusMap?.has(entry.path) && (
              <WorkingTreeDot
                status={workingTreeStatusMap.get(entry.path)!}
                hideOnHover={
                  (hasReviewActions && hasReviewableContent) ||
                  !!onStage ||
                  !!onUnstage
                }
              />
            )}

            <StatusLetter
              status={entry.status}
              hideOnHover={
                (hasReviewActions && hasReviewableContent) ||
                !!onStage ||
                !!onUnstage
              }
            />
          </TreeRow>
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
      prev.onRejectAll === next.onRejectAll &&
      prev.movedFilePaths === next.movedFilePaths &&
      prev.repoPath === next.repoPath &&
      prev.revealLabel === next.revealLabel &&
      prev.onOpenInSplit === next.onOpenInSplit &&
      prev.onStage === next.onStage &&
      prev.onUnstage === next.onUnstage &&
      prev.workingTreeStatusMap === next.workingTreeStatusMap &&
      prev.collapsible === next.collapsible &&
      prev.showSizeBar === next.showSizeBar
    );
  },
);
