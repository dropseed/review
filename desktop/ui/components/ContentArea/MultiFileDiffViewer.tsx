import { type ReactNode, useCallback } from "react";
import { Virtualizer } from "@pierre/diffs/react";
import { useSpurStore } from "../../stores";
import { GroupDiffViewer } from "../GuideView/GroupDiffViewer";
import type { HunkGroup } from "../../types";

const VIRTUALIZER_STYLE = { overflow: "auto" } as const;

interface MultiFileDiffViewerProps {
  /**
   * Render this group instead of resolving one from the store. Used for the
   * default needs-review view, which is implicit render state rather than a
   * stored overlay — it gets no close button (there is nothing to close it
   * into; picking a file is how you leave it) and no group-index badge.
   */
  group?: HunkGroup;
}

export function MultiFileDiffViewer({
  group: groupProp,
}: MultiFileDiffViewerProps): ReactNode {
  const guideContentMode = useSpurStore((s) => s.guideContentMode);
  const activeEntry = useSpurStore((s) => s.getActiveGroupingEntry());
  const reviewGroups = activeEntry.reviewGroups;
  const activeGroupIndex = useSpurStore((s) => s.activeGroupIndex);
  const adhocGroup = useSpurStore((s) => s.adhocGroup);

  const handleClose = useCallback(() => {
    useSpurStore.setState({
      guideContentMode: null,
      selectedFile: null,
      adhocGroup: null,
    });
  }, []);

  // Resolve which group and optional index to render
  const isAdhoc = guideContentMode === "adhoc-group";
  const group =
    groupProp ??
    (isAdhoc ? adhocGroup : (reviewGroups[activeGroupIndex] ?? null));
  const groupIndex = groupProp || isAdhoc ? undefined : activeGroupIndex;

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
          onClose={groupProp ? undefined : handleClose}
        />
      </Virtualizer>
    </div>
  );
}
