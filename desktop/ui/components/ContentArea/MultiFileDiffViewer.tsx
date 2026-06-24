import { type ReactNode, useCallback } from "react";
import { Virtualizer } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores";
import { GroupDiffViewer } from "../GuideView/GroupDiffViewer";

const VIRTUALIZER_STYLE = { overflow: "auto" } as const;

export function MultiFileDiffViewer(): ReactNode {
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const activeEntry = useReviewStore((s) => s.getActiveGroupingEntry());
  const reviewGroups = activeEntry.reviewGroups;
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const adhocGroup = useReviewStore((s) => s.adhocGroup);

  const handleClose = useCallback(() => {
    useReviewStore.setState({
      guideContentMode: null,
      selectedFile: null,
      adhocGroup: null,
    });
  }, []);

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
      <Virtualizer className="flex-1 scrollbar-thin" style={VIRTUALIZER_STYLE}>
        <GroupDiffViewer
          group={group}
          groupIndex={groupIndex}
          headerBadge={
            group.badgeLabel ? (
              <span className="text-xs font-medium text-status-trusted bg-status-trusted/10 px-2 py-0.5 rounded-full">
                {group.badgeLabel}
              </span>
            ) : undefined
          }
          onClose={handleClose}
        />
      </Virtualizer>
    </div>
  );
}
