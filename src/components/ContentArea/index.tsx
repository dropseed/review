import { useState, useCallback, lazy, Suspense } from "react";
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

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <svg
        className="h-12 w-12 text-surface-hover"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>
      <p className="text-sm text-fg-muted">Select a file to review</p>
    </div>
  );
}

export function ContentArea() {
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

  // Guide content takes priority when active
  if (guideContentMode === "overview") {
    return (
      <Suspense fallback={null}>
        <OverviewContent />
      </Suspense>
    );
  }
  if (guideContentMode === "group") {
    return (
      <Suspense fallback={null}>
        <MultiFileDiffViewer />
      </Suspense>
    );
  }

  // No file selected - show empty state with Start Guide
  if (!selectedFile && !secondaryFile) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <EmptyState />
      </div>
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
