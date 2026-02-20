import { memo } from "react";
import {
  TreeNodeItem,
  TreeRow,
  StatusLetter,
  HunkCount,
  TreeFileIcon,
  WorkingTreeDot,
} from "../tree";
import type { FileHunkStatus } from "./types";
import { ApprovalButtons, StageButtons, type HunkContext } from "./FileNode";
import { NodeOverflowMenu } from "./NodeOverflowMenu";

interface FlatFileNodeProps {
  filePath: string;
  fileStatus: string | undefined;
  hunkStatus: FileHunkStatus;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  hunkContext: HunkContext;
  onApproveAll?: (path: string, isDir: boolean) => void;
  onUnapproveAll?: (path: string, isDir: boolean) => void;
  onRejectAll?: (path: string, isDir: boolean) => void;
  movedFilePaths?: Set<string>;
  onStage?: (path: string, isDir: boolean) => void;
  onUnstage?: (path: string, isDir: boolean) => void;
  workingTreeStatusMap?: Map<string, string>;
}

export const FlatFileNode = memo(function FlatFileNode({
  filePath,
  fileStatus,
  hunkStatus,
  selectedFile,
  onSelectFile,
  hunkContext,
  onApproveAll,
  onUnapproveAll,
  onRejectAll,
  movedFilePaths,
  onStage,
  onUnstage,
  workingTreeStatusMap,
}: FlatFileNodeProps) {
  const isSelected = selectedFile === filePath;
  const hasReviewableContent = hunkStatus.total > 0;
  const hasPending = hunkStatus.pending > 0;
  const hasApproved = hunkStatus.approved > 0;
  const hasReviewActions = !!(onApproveAll && onUnapproveAll && onRejectAll);
  const hasHoverActions =
    (hasReviewActions && hasReviewableContent) || !!onStage || !!onUnstage;

  const lastSlash = filePath.lastIndexOf("/");
  const dirPath = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : "";
  const fileName =
    lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;

  return (
    <TreeNodeItem>
      <TreeRow
        depth={0}
        className={
          isSelected
            ? "bg-status-modified/15 border-l-2 border-l-status-modified"
            : "border-l-2 border-l-transparent hover:bg-surface-raised/40"
        }
      >
        <TreeFileIcon name={fileName} isDirectory={false} />

        <button
          className="flex flex-1 items-center text-left min-w-0"
          onClick={() => onSelectFile(filePath)}
        >
          <span
            className={`min-w-0 truncate text-xs ${isSelected ? "text-fg" : "text-fg-secondary"}`}
          >
            {dirPath && <span className="text-fg-muted">{dirPath}</span>}
            {fileName}
          </span>
          {movedFilePaths?.has(filePath) && (
            <span className="flex-shrink-0 rounded bg-status-renamed/15 px-1 py-0.5 text-xxs font-medium text-status-renamed">
              Moved
            </span>
          )}
        </button>

        {hasReviewActions && hasReviewableContent && (
          <ApprovalButtons
            hasPending={hasPending}
            hasApproved={hasApproved}
            onApprove={() => onApproveAll!(filePath, false)}
            onUnapprove={() => onUnapproveAll!(filePath, false)}
          />
        )}

        {hasReviewActions && (
          <NodeOverflowMenu
            path={filePath}
            isDirectory={false}
            hasPending={hasPending}
            hasApproved={hasApproved}
            hasRejected={hunkStatus.rejected > 0}
            onApproveAll={() => onApproveAll!(filePath, false)}
            onRejectAll={() => onRejectAll!(filePath, false)}
            onUnapproveAll={() => onUnapproveAll!(filePath, false)}
          />
        )}

        {(onStage || onUnstage) && (
          <StageButtons
            onStage={onStage ? () => onStage(filePath, false) : undefined}
            onUnstage={onUnstage ? () => onUnstage(filePath, false) : undefined}
          />
        )}

        {workingTreeStatusMap?.has(filePath) && (
          <WorkingTreeDot
            status={workingTreeStatusMap.get(filePath)!}
            hideOnHover={hasHoverActions}
          />
        )}

        {hasReviewableContent && (
          <HunkCount
            status={hunkStatus}
            context={hunkContext}
            hideOnHover={hasHoverActions}
          />
        )}

        <StatusLetter status={fileStatus} hideOnHover={hasHoverActions} />
      </TreeRow>
    </TreeNodeItem>
  );
});
