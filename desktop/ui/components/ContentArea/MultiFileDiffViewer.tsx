import { type ReactNode, useCallback } from "react";
import { useReviewStore } from "../../stores";
import { GroupDiffViewer } from "../GuideView/GroupDiffViewer";

export function MultiFileDiffViewer(): ReactNode {
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const groupingLoading = useReviewStore((s) => s.groupingLoading);
  const adhocGroup = useReviewStore((s) => s.adhocGroup);

  const handleClose = useCallback(() => {
    useReviewStore.setState({
      guideContentMode: null,
      selectedFile: null,
      adhocGroup: null,
    });
  }, []);

  if (groupingLoading && guideContentMode !== "adhoc-group") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-edge-default border-t-guide animate-spin" />
          </div>
          <h2 className="text-lg font-semibold text-fg-secondary">
            Analyzing changes...
          </h2>
          <p className="text-sm text-fg-muted">
            Claude is organizing hunks into logical groups for review.
          </p>
        </div>
      </div>
    );
  }

  // Resolve which group and optional index to render
  const isAdhoc = guideContentMode === "adhoc-group";
  const group = isAdhoc ? adhocGroup : (reviewGroups[activeGroupIndex] ?? null);
  const groupIndex = isAdhoc ? undefined : activeGroupIndex;

  if (!group) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-fg-muted">No group selected</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <GroupDiffViewer
          group={group}
          groupIndex={groupIndex}
          headerBadge={
            isAdhoc ? (
              <span className="text-xs font-medium text-status-trusted bg-status-trusted/10 px-2 py-0.5 rounded-full">
                Trust pattern
              </span>
            ) : undefined
          }
          onClose={handleClose}
        />
      </div>
    </div>
  );
}
