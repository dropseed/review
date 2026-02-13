import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { GroupDiffViewer } from "../GuideView/GroupDiffViewer";

export function MultiFileDiffViewer(): ReactNode {
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const groupingLoading = useReviewStore((s) => s.groupingLoading);

  if (groupingLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-purple-500 animate-spin" />
          </div>
          <h2 className="text-lg font-semibold text-stone-200">
            Analyzing changes...
          </h2>
          <p className="text-sm text-stone-500">
            Claude is organizing hunks into logical groups for review.
          </p>
        </div>
      </div>
    );
  }

  if (reviewGroups.length === 0 || activeGroupIndex >= reviewGroups.length) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-stone-500">No group selected</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <GroupDiffViewer
          group={reviewGroups[activeGroupIndex]}
          groupIndex={activeGroupIndex}
        />
      </div>
    </div>
  );
}
