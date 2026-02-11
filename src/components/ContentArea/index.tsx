import { useState, useCallback } from "react";
import { useReviewStore } from "../../stores";
import { FileViewer } from "../FileViewer";
import { GuideView } from "../GuideView";
import { PrimaryPaneHeader, SecondaryPaneHeader } from "./PaneHeader";
import { ResizeHandle } from "./ResizeHandle";

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
      />
    </svg>
  );
}

function StartGuideButton() {
  const startGuide = useReviewStore((s) => s.startGuide);
  const guideLoading = useReviewStore((s) => s.guideLoading);
  const guideRecommended = useReviewStore((s) => s.hunks.length >= 8);
  const hunks = useReviewStore((s) => s.hunks);
  const flatFileList = useReviewStore((s) => s.flatFileList);

  const primaryStyle = guideRecommended
    ? "bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 border border-violet-500/20"
    : "text-stone-400 hover:text-stone-200 hover:bg-stone-800/50 border border-stone-700/50";

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={startGuide}
        disabled={guideLoading || hunks.length === 0}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${primaryStyle}`}
      >
        {guideLoading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <SparklesIcon className="h-4 w-4" />
        )}
        {guideLoading ? "Starting…" : "Guided Review"}
      </button>
      <p className="text-xs text-stone-500">
        {hunks.length} hunks across {flatFileList.length} files
      </p>
      {!guideRecommended && hunks.length > 0 && (
        <p className="text-xs text-stone-600">Small diff — guide optional</p>
      )}
    </div>
  );
}

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

  // Guide mode - unified guided scroll view
  if (topLevelView === "guide") {
    return <GuideView />;
  }

  // No file selected - show empty state with Start Guide
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
          <StartGuideButton />
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
