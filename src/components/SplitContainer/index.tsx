import { useState, useCallback } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { CodeViewer } from "../CodeViewer";
import { OverviewView } from "../OverviewView";
import { PaneHeader } from "./PaneHeader";
import { ResizeHandle } from "./ResizeHandle";

export function SplitContainer() {
  const {
    selectedFile,
    secondaryFile,
    focusedPane,
    splitOrientation,
    topLevelView,
    setFocusedPane,
    closeSplit,
    swapPanes,
    setSplitOrientation,
    navigateToOverview,
  } = useReviewStore();

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
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeViewer filePath={selectedFile} />
        </div>
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
          focusedPane === "primary" ? "ring-1 ring-inset ring-amber-500/30" : ""
        }`}
        style={isHorizontal ? { width: primarySize } : { height: primarySize }}
        onClick={handlePrimaryClick}
      >
        <PaneHeader
          label="Primary"
          isFocused={focusedPane === "primary"}
          showOrientationToggle
          orientation={splitOrientation}
          onToggleOrientation={() =>
            setSplitOrientation(isHorizontal ? "vertical" : "horizontal")
          }
          showSwap
          onSwap={swapPanes}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedFile ? (
            <CodeViewer filePath={selectedFile} />
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
            ? "ring-1 ring-inset ring-amber-500/30"
            : ""
        }`}
        style={
          isHorizontal ? { width: secondarySize } : { height: secondarySize }
        }
        onClick={handleSecondaryClick}
      >
        <PaneHeader
          label="Secondary"
          isFocused={focusedPane === "secondary"}
          showSwap
          showClose
          onSwap={swapPanes}
          onClose={closeSplit}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeViewer filePath={secondaryFile} />
        </div>
      </div>
    </div>
  );
}
