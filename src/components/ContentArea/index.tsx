import { useState, useCallback } from "react";
import { useReviewStore } from "../../stores";
import { FileViewer } from "../FileViewer";
import { OverviewView } from "../OverviewView";
import { PrimaryPaneHeader, SecondaryPaneHeader } from "./PaneHeader";
import { ResizeHandle } from "./ResizeHandle";

export function ContentArea() {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const focusedPane = useReviewStore((s) => s.focusedPane);
  const splitOrientation = useReviewStore((s) => s.splitOrientation);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const setFocusedPane = useReviewStore((s) => s.setFocusedPane);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const swapPanes = useReviewStore((s) => s.swapPanes);
  const setSplitOrientation = useReviewStore((s) => s.setSplitOrientation);
  const navigateToOverview = useReviewStore((s) => s.navigateToOverview);

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

  // Overview mode - show symbol-level changes for all files
  if (topLevelView === "overview") {
    return <OverviewView />;
  }

  // No file selected - show empty state with link to overview
  if (!selectedFile && !secondaryFile) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <svg
            className="h-12 w-12 text-stone-700"
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
          <p className="text-sm text-stone-500">Select a file to review</p>
          <button
            onClick={navigateToOverview}
            className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            Return to Overview
          </button>
        </div>
      </div>
    );
  }

  // Single pane mode
  if (!isSplitActive) {
    return selectedFile ? (
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <FileViewer filePath={selectedFile} />
      </div>
    ) : null;
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
        className={`flex min-h-0 flex-col overflow-hidden ${
          focusedPane === "primary"
            ? "inset-ring-1 inset-ring-amber-500/30"
            : ""
        }`}
        style={isHorizontal ? { width: primarySize } : { height: primarySize }}
        onClick={handlePrimaryClick}
      >
        <PrimaryPaneHeader
          label="Primary"
          isFocused={focusedPane === "primary"}
          orientation={splitOrientation}
          onToggleOrientation={() =>
            setSplitOrientation(isHorizontal ? "vertical" : "horizontal")
          }
          onSwap={swapPanes}
        />
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
          {selectedFile ? (
            <FileViewer filePath={selectedFile} />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-500 text-sm">
              No file selected
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle */}
      <ResizeHandle
        orientation={splitOrientation}
        onResize={setSplitFraction}
      />

      {/* Secondary Pane */}
      <div
        className={`flex min-h-0 flex-col overflow-hidden ${
          focusedPane === "secondary"
            ? "inset-ring-1 inset-ring-amber-500/30"
            : ""
        }`}
        style={
          isHorizontal ? { width: secondarySize } : { height: secondarySize }
        }
        onClick={handleSecondaryClick}
      >
        <SecondaryPaneHeader
          label="Secondary"
          isFocused={focusedPane === "secondary"}
          onSwap={swapPanes}
          onClose={closeSplit}
        />
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
          <FileViewer filePath={secondaryFile} />
        </div>
      </div>
    </div>
  );
}
