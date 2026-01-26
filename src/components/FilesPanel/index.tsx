import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { platform } from "@tauri-apps/plugin-os";
import { ExportModal } from "../ExportModal";
import type { ViewMode, ContextMenuState } from "./types";
import { calculateFileHunkStatus, processTree } from "./FileTree.utils";
import { ContextMenu } from "./ContextMenu";
import { FeedbackPanel } from "./FeedbackPanel";
import { FileNode } from "./FileNode";

// Collapsible section container
function CollapsibleSection({
  title,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  badge?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-stone-800">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-inset"
        aria-expanded={isOpen}
      >
        <svg
          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="flex-1">{title}</span>
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium text-amber-400 tabular-nums">
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function FilesPanel() {
  const {
    repoPath,
    allFiles,
    allFilesLoading,
    selectedFile,
    setSelectedFile,
    fileToReveal,
    clearFileToReveal,
    reviewState,
    hunks,
    setReviewNotes,
    completeReview,
    deleteAnnotation,
    revealFileInTree,
  } = useReviewStore();

  const [viewMode, setViewMode] = useState<ViewMode>("changes");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState(true);
  const [platformName, setPlatformName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const fileRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Detect platform
  useEffect(() => {
    setPlatformName(platform());
  }, []);

  // Calculate hunk status per file
  const hunkStatusMap = useMemo(
    () => calculateFileHunkStatus(hunks, reviewState),
    [hunks, reviewState],
  );

  // Process tree
  const processedFiles = useMemo(
    () => processTree(allFiles, hunkStatusMap, viewMode),
    [allFiles, hunkStatusMap, viewMode],
  );

  // Overall stats
  const stats = useMemo(() => {
    let pending = 0,
      approved = 0,
      trusted = 0,
      rejected = 0;
    for (const status of hunkStatusMap.values()) {
      pending += status.pending;
      approved += status.approved;
      trusted += status.trusted;
      rejected += status.rejected;
    }
    const total = pending + approved + trusted + rejected;
    const reviewed = approved + trusted + rejected;
    return { pending, approved, trusted, rejected, total, reviewed };
  }, [hunkStatusMap]);

  // Reveal file in tree
  useEffect(() => {
    if (fileToReveal) {
      const parts = fileToReveal.split("/");
      const pathsToExpand = new Set(expandedPaths);
      for (let i = 1; i < parts.length; i++) {
        pathsToExpand.add(parts.slice(0, i).join("/"));
      }
      setExpandedPaths(pathsToExpand);

      setTimeout(() => {
        const ref = fileRefs.current.get(fileToReveal);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      clearFileToReveal();
    }
  }, [fileToReveal, clearFileToReveal, expandedPaths]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
    },
    [setSelectedFile],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.preventDefault();
      const fullPath = `${repoPath}/${path}`;
      const revealLabel =
        platformName === "macos"
          ? "Reveal in Finder"
          : platformName === "windows"
            ? "Reveal in Explorer"
            : "Reveal in Files";
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        path,
        fullPath,
        revealLabel,
      });
    },
    [repoPath, platformName],
  );

  const registerRef = useCallback(
    (path: string, el: HTMLButtonElement | null) => {
      if (el) {
        fileRefs.current.set(path, el);
      } else {
        fileRefs.current.delete(path);
      }
    },
    [],
  );

  // Check if there's feedback to export
  const hasFeedbackToExport = useMemo(() => {
    const hasRejections = stats.rejected > 0;
    const hasAnnotations = (reviewState?.annotations ?? []).length > 0;
    const hasNotes = (reviewState?.notes ?? "").trim().length > 0;
    return hasRejections || hasAnnotations || hasNotes;
  }, [stats.rejected, reviewState?.annotations, reviewState?.notes]);

  if (allFilesLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
          <span className="text-sm text-stone-500">Loading files…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      )}

      {reviewState && (
        <ExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          comparison={reviewState.comparison}
          hunks={hunks}
          hunkStates={reviewState.hunks}
          annotations={reviewState.annotations ?? []}
          notes={reviewState.notes}
        />
      )}

      <div className="flex h-full flex-col">
        {/* View mode toggle */}
        <div className="border-b border-stone-800 px-3 py-2">
          <div className="flex rounded-md bg-stone-800 p-0.5">
            <button
              onClick={() => setViewMode("changes")}
              className={`flex-1 rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                viewMode === "changes"
                  ? "bg-stone-700 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Changes
            </button>
            <button
              onClick={() => setViewMode("all")}
              className={`flex-1 rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                viewMode === "all"
                  ? "bg-stone-700 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              All Files
            </button>
          </div>
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {processedFiles.length > 0 ? (
            processedFiles.map((entry) => (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={0}
                expandedPaths={expandedPaths}
                onToggle={togglePath}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                onContextMenu={handleContextMenu}
                registerRef={registerRef}
                viewMode={viewMode}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <svg
                className="mb-3 h-8 w-8 text-stone-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-stone-400">No changes to review</p>
            </div>
          )}

          {/* All done message */}
          {stats.total > 0 && stats.pending === 0 && (
            <div className="flex flex-col items-center py-6 text-center border-t border-stone-800 mt-2">
              <svg
                className="mb-2 h-6 w-6 text-lime-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="text-sm text-lime-400">All hunks reviewed</p>
            </div>
          )}
        </div>

        {/* Feedback (Notes + Annotations) */}
        <CollapsibleSection
          title="Feedback"
          badge={(reviewState?.annotations ?? []).length}
          isOpen={notesOpen}
          onToggle={() => setNotesOpen(!notesOpen)}
        >
          <FeedbackPanel
            notes={reviewState?.notes || ""}
            onNotesChange={setReviewNotes}
            annotations={reviewState?.annotations ?? []}
            onGoToAnnotation={(annotation) => {
              revealFileInTree(annotation.filePath);
            }}
            onDeleteAnnotation={deleteAnnotation}
          />
        </CollapsibleSection>

        {/* Actions */}
        <div className="border-t border-stone-800 p-3 space-y-2">
          {reviewState?.completedAt ? (
            <div className="rounded bg-lime-500/10 px-3 py-2 text-center text-xs text-lime-400">
              Completed {new Date(reviewState.completedAt).toLocaleDateString()}
            </div>
          ) : stats.total > 0 ? (
            <button
              onClick={() => completeReview()}
              disabled={stats.pending > 0}
              className={`btn w-full text-xs ${
                stats.pending === 0
                  ? "btn-primary"
                  : "cursor-not-allowed bg-stone-800 text-stone-500"
              }`}
            >
              {stats.pending > 0
                ? `${stats.pending} pending`
                : "Complete Review"}
            </button>
          ) : null}

          {hasFeedbackToExport && (
            <button
              onClick={() => setShowExportModal(true)}
              className="btn w-full text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20"
            >
              <svg
                className="h-3.5 w-3.5 mr-1.5 inline-block"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              Export Feedback
            </button>
          )}
        </div>
      </div>
    </>
  );
}
