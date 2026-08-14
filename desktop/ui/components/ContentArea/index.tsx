import { type ReactNode, useRef, useCallback, lazy, Suspense } from "react";
import { useReviewStore } from "../../stores";
import { FileViewer } from "../FileViewer";
import { ResizeHandle } from "./ResizeHandle";
import { toggleToCanonical } from "../../utils/resize";
const MultiFileDiffViewer = lazy(() =>
  import("./MultiFileDiffViewer").then((m) => ({
    default: m.MultiFileDiffViewer,
  })),
);
const WorkingTreeMultiFileDiffViewer = lazy(() =>
  import("./WorkingTreeMultiFileDiffViewer").then((m) => ({
    default: m.WorkingTreeMultiFileDiffViewer,
  })),
);
const SearchView = lazy(() =>
  import("../search/SearchView").then((m) => ({ default: m.SearchView })),
);

/**
 * Nothing open yet.
 *
 * A sentence and the way to a file, and deliberately nothing else: this used to
 * be a whole second screen — a progress header, a file tree with its own
 * per-file fractions, a symbol listing — restating what the files column beside
 * it already says. What is left to review is that column's job now, and the
 * workspace's own state is the sidebar's.
 */
function NoFileSelected(): ReactNode {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs -translate-y-[8vh] text-center">
        <p className="text-sm text-fg-muted">Select a file to review.</p>
        <p className="mt-2 text-sm text-fg-faint">
          <kbd className="font-mono">⌘P</kbd> to find one.
        </p>
      </div>
    </div>
  );
}

export function ContentArea(): ReactNode {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const externalFilePath = useReviewStore((s) => s.externalFilePath);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const focusedPane = useReviewStore((s) => s.focusedPane);
  const splitOrientation = useReviewStore((s) => s.splitOrientation);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const workingTreeMultiView = useReviewStore((s) => s.workingTreeMultiView);
  const searchViewOpen = useReviewStore((s) => s.searchViewOpen);
  const setFocusedPane = useReviewStore((s) => s.setFocusedPane);

  // When viewing an external file (from LSP go-to-definition), use that path
  const effectiveFile = externalFilePath ?? selectedFile;
  // Split size as a fraction (0.5 = 50/50 split). A fraction rather than px
  // because the two panes are peers dividing one region — the same split reads
  // correctly on an ultrawide and on a laptop with no conversion.
  const splitFraction = useReviewStore((s) => s.diffSplitFraction);
  const setSplitFraction = useReviewStore((s) => s.setDiffSplitFraction);

  // Double-click evens the split out; double-clicking again restores the
  // lopsided one you had, so the gesture is its own undo.
  const rememberedSplit = useRef<number | null>(null);
  const handleSplitReset = useCallback(() => {
    const { next, remember } = toggleToCanonical(
      useReviewStore.getState().diffSplitFraction,
      0.5,
      rememberedSplit.current,
      0.5,
      0.005,
    );
    rememberedSplit.current = remember;
    setSplitFraction(next);
  }, [setSplitFraction]);

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

  // Search results take the content area while they are open — picking one
  // navigates to the file, which is what closes them.
  if (searchViewOpen) {
    return (
      <Suspense fallback={null}>
        <SearchView />
      </Suspense>
    );
  }

  // Multi-file group view takes priority when active
  if (guideContentMode !== null) {
    return (
      <Suspense fallback={null}>
        <MultiFileDiffViewer />
      </Suspense>
    );
  }

  // Working-tree rolling diff (Git panel "view as rolling diff")
  if (workingTreeMultiView !== null) {
    return (
      <Suspense fallback={null}>
        <WorkingTreeMultiFileDiffViewer />
      </Suspense>
    );
  }

  if (!effectiveFile && !secondaryFile) {
    return <NoFileSelected />;
  }

  // Single pane mode
  if (!isSplitActive) {
    if (!effectiveFile) return null;
    return (
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <FileViewer filePath={effectiveFile} pane="primary" />
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
            pane="primary"
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
        onReset={handleSplitReset}
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
            pane="secondary"
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
