import { type ReactNode, useState, useCallback, lazy, Suspense } from "react";
import { useReviewStore } from "../../stores";
import { FileViewer } from "../FileViewer";
import { ResizeHandle } from "./ResizeHandle";

const OverviewContent = lazy(() =>
  import("./OverviewContent").then((m) => ({ default: m.OverviewContent })),
);
const MultiFileDiffViewer = lazy(() =>
  import("./MultiFileDiffViewer").then((m) => ({
    default: m.MultiFileDiffViewer,
  })),
);

export function ContentArea(): ReactNode {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const focusedPane = useReviewStore((s) => s.focusedPane);
  const splitOrientation = useReviewStore((s) => s.splitOrientation);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const setFocusedPane = useReviewStore((s) => s.setFocusedPane);
  // Split size as a fraction (0.5 = 50/50 split)
  const [splitFraction, setSplitFraction] = useState(0.5);

  const handlePrimaryClick = useCallback(() => {
    if (secondaryFile !== null) {
      setFocusedPane("primary");
    }
  }, [secondaryFile, setFocusedPane]);

  const handleSecondaryClick = useCallback(() => {
    setFocusedPane("secondary");
  }, [setFocusedPane]);

  const isSplitActive = secondaryFile !== null;
  const isHorizontal = splitOrientation === "horizontal";

  // Group view takes priority when active
  if (guideContentMode === "group") {
    return (
      <Suspense fallback={null}>
        <MultiFileDiffViewer />
      </Suspense>
    );
  }

  // No file selected: show overview
  if (!selectedFile && !secondaryFile) {
    return (
      <Suspense fallback={null}>
        <OverviewContent />
      </Suspense>
    );
  }

  // Single pane mode
  if (!isSplitActive) {
    if (!selectedFile) return null;
    return (
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <FileViewer filePath={selectedFile} />
      </div>
    );
  }

  // Split mode
  const primarySize = `${splitFraction * 100}%`;
  const secondarySize = `${(1 - splitFraction) * 100}%`;

  return (
    <div
      className={`flex flex-1 min-h-0 overflow-hidden ${isHorizontal ? "flex-row" : "flex-col"}`}
    >
      {/* Primary Pane */}
      <div
        className="flex min-h-0 flex-col overflow-hidden"
        style={isHorizontal ? { width: primarySize } : { height: primarySize }}
        onClick={handlePrimaryClick}
      >
        {selectedFile ? (
          <FileViewer
            filePath={selectedFile}
            isFocusedPane={focusedPane === "primary"}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-fg-muted text-sm">
            No file selected
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <ResizeHandle
        orientation={splitOrientation}
        onResize={setSplitFraction}
      />

      {/* Secondary Pane */}
      <div
        className="flex min-h-0 flex-col overflow-hidden"
        style={
          isHorizontal ? { width: secondarySize } : { height: secondarySize }
        }
        onClick={handleSecondaryClick}
      >
        {secondaryFile ? (
          <FileViewer
            filePath={secondaryFile}
            isFocusedPane={focusedPane === "secondary"}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-fg-muted text-sm">
            Select a file to view
          </div>
        )}
      </div>
    </div>
  );
}
