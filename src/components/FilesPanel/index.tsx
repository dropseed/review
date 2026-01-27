import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { platform } from "@tauri-apps/plugin-os";
import { ExportModal } from "../ExportModal";
import type { ViewMode, ContextMenuState } from "./types";
import {
  calculateFileHunkStatus,
  processTree,
  processTreeWithSections,
} from "./FileTree.utils";
import { ContextMenu } from "./ContextMenu";
import { FeedbackPanel } from "./FeedbackPanel";
import { FileNode } from "./FileNode";

// Simple section header (non-collapsible)
function SectionHeader({
  title,
  badge,
  badgeColor = "amber",
  onExpandAll,
  onCollapseAll,
  showTreeControls,
  showTopBorder = true,
  children,
}: {
  title: string;
  badge?: number;
  badgeColor?: "amber" | "lime" | "cyan";
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  showTreeControls?: boolean;
  showTopBorder?: boolean;
  children: React.ReactNode;
}) {
  const badgeColors = {
    amber: "bg-amber-500/20 text-amber-400",
    lime: "bg-lime-500/20 text-lime-400",
    cyan: "bg-cyan-500/20 text-cyan-400",
  };

  return (
    <div
      className={`border-b border-stone-800 ${showTopBorder ? "border-t" : ""}`}
    >
      <div className="flex items-center">
        <div className="flex flex-1 items-center gap-2 px-3 py-2 text-xs font-medium text-stone-300">
          <span className="flex-1">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeColors[badgeColor]}`}
            >
              {badge}
            </span>
          )}
        </div>
        {showTreeControls && onExpandAll && onCollapseAll && (
          <div className="flex items-center gap-0.5 pr-2">
            <button
              onClick={onExpandAll}
              title="Expand all"
              className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <rect x="2" y="2" width="12" height="12" rx="1" />
                <path d="M8 5v6M5 8h6" />
              </svg>
            </button>
            <button
              onClick={onCollapseAll}
              title="Collapse all"
              className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <rect x="2" y="2" width="12" height="12" rx="1" />
                <path d="M5 8h6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// Collapsible section container (for Feedback)
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
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-inset"
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
      </div>
      {isOpen && children}
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
    directoryToReveal,
    clearDirectoryToReveal,
    reviewState,
    hunks,
    setReviewNotes,
    completeReview,
    deleteAnnotation,
    revealFileInTree,
    approveAllFileHunks,
    unapproveAllFileHunks,
    approveAllDirHunks,
    unapproveAllDirHunks,
    openInSplit,
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

  // Process sectioned tree for Changes sections (Needs Review vs Reviewed)
  const sectionedFiles = useMemo(
    () => processTreeWithSections(allFiles, hunkStatusMap),
    [allFiles, hunkStatusMap],
  );

  // Process tree for All Files section
  const allFilesTree = useMemo(
    () => processTree(allFiles, hunkStatusMap, "all"),
    [allFiles, hunkStatusMap],
  );

  // Overall stats - count FILES not hunks for section badges
  const stats = useMemo(() => {
    let needsReviewFiles = 0;
    let reviewedFiles = 0;
    let totalHunks = 0;
    let pendingHunks = 0;
    let rejectedHunks = 0;

    for (const status of hunkStatusMap.values()) {
      totalHunks += status.total;
      pendingHunks += status.pending;
      rejectedHunks += status.rejected;

      if (status.total > 0) {
        if (status.pending > 0) {
          needsReviewFiles++;
        } else {
          reviewedFiles++;
        }
      }
    }

    return {
      pending: pendingHunks,
      total: totalHunks,
      rejected: rejectedHunks,
      needsReviewFiles,
      reviewedFiles,
    };
  }, [hunkStatusMap]);

  // Collect all directory paths for expand/collapse all
  const allDirPaths = useMemo(() => {
    const paths = new Set<string>();
    function collect(entries: typeof allFilesTree) {
      for (const entry of entries) {
        if (entry.isDirectory && entry.matchesFilter) {
          for (const p of entry.compactedPaths) {
            paths.add(p);
          }
          if (entry.children) {
            collect(entry.children);
          }
        }
      }
    }
    collect(sectionedFiles.needsReview);
    collect(sectionedFiles.reviewed);
    collect(allFilesTree);
    return paths;
  }, [allFilesTree, sectionedFiles]);

  const expandAll = useCallback(() => {
    setExpandedPaths(new Set(allDirPaths));
  }, [allDirPaths]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

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

  // Helper to check if a directory path exists in the processed tree
  const directoryExistsInTree = useCallback(
    (dirPath: string, entries: typeof allFilesTree): boolean => {
      for (const entry of entries) {
        if (!entry.matchesFilter) continue;
        // Check if this entry's path or compacted paths include the directory
        if (entry.compactedPaths.includes(dirPath)) return true;
        if (entry.path === dirPath) return true;
        if (entry.isDirectory && entry.children) {
          if (directoryExistsInTree(dirPath, entry.children)) return true;
        }
      }
      return false;
    },
    [],
  );

  // Reveal directory in tree (from breadcrumb clicks)
  useEffect(() => {
    if (directoryToReveal) {
      // Check if directory exists in changes sections
      const existsInChanges =
        directoryExistsInTree(directoryToReveal, sectionedFiles.needsReview) ||
        directoryExistsInTree(directoryToReveal, sectionedFiles.reviewed);

      // If not in changes sections, switch to All Files view
      if (!existsInChanges && viewMode !== "all") {
        setViewMode("all");
      }

      // Expand parent paths
      const parts = directoryToReveal.split("/");
      const pathsToExpand = new Set(expandedPaths);
      for (let i = 1; i <= parts.length; i++) {
        pathsToExpand.add(parts.slice(0, i).join("/"));
      }
      setExpandedPaths(pathsToExpand);

      // Scroll to directory after a short delay to allow expansion
      setTimeout(() => {
        const ref = fileRefs.current.get(directoryToReveal);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      clearDirectoryToReveal();
    }
  }, [
    directoryToReveal,
    clearDirectoryToReveal,
    directoryExistsInTree,
    sectionedFiles,
    viewMode,
    expandedPaths,
  ]);

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

  const handleApproveAll = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir) {
        approveAllDirHunks(path);
      } else {
        approveAllFileHunks(path);
      }
    },
    [approveAllFileHunks, approveAllDirHunks],
  );

  const handleUnapproveAll = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir) {
        unapproveAllDirHunks(path);
      } else {
        unapproveAllFileHunks(path);
      }
    },
    [unapproveAllFileHunks, unapproveAllDirHunks],
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
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInSplit={openInSplit}
        />
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
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {viewMode === "changes" ? (
            <>
              {/* Needs Review section */}
              <SectionHeader
                title="Needs Review"
                badge={stats.needsReviewFiles}
                badgeColor="amber"
                onExpandAll={expandAll}
                onCollapseAll={collapseAll}
                showTreeControls={allDirPaths.size > 0}
                showTopBorder={false}
              >
                <div className="py-1">
                  {sectionedFiles.needsReview.length > 0 ? (
                    sectionedFiles.needsReview.map((entry) => (
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
                        hunkContext="needs-review"
                        onApproveAll={handleApproveAll}
                        onUnapproveAll={handleUnapproveAll}
                      />
                    ))
                  ) : (
                    <div className="py-4 text-center">
                      <svg
                        className="mx-auto mb-2 h-6 w-6 text-lime-500"
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
                      <p className="text-xs text-stone-500">
                        No files need review
                      </p>
                    </div>
                  )}
                </div>
              </SectionHeader>

              {/* Reviewed section */}
              <SectionHeader
                title="Reviewed"
                badge={stats.reviewedFiles}
                badgeColor="lime"
                onExpandAll={expandAll}
                onCollapseAll={collapseAll}
                showTreeControls={allDirPaths.size > 0}
              >
                <div className="py-1">
                  {sectionedFiles.reviewed.length > 0 ? (
                    sectionedFiles.reviewed.map((entry) => (
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
                        hunkContext="reviewed"
                        onApproveAll={handleApproveAll}
                        onUnapproveAll={handleUnapproveAll}
                      />
                    ))
                  ) : (
                    <div className="py-4 text-center">
                      <p className="text-xs text-stone-500">
                        No files reviewed yet
                      </p>
                    </div>
                  )}
                </div>
              </SectionHeader>
            </>
          ) : (
            <>
              {/* All Files header with expand/collapse */}
              <div className="flex items-center border-b border-stone-800">
                <div className="flex-1 px-3 py-2 text-xs font-medium text-stone-300">
                  All Files
                </div>
                {allDirPaths.size > 0 && (
                  <div className="flex items-center gap-0.5 pr-2">
                    <button
                      onClick={expandAll}
                      title="Expand all"
                      className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 16 16"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <rect x="2" y="2" width="12" height="12" rx="1" />
                        <path d="M8 5v6M5 8h6" />
                      </svg>
                    </button>
                    <button
                      onClick={collapseAll}
                      title="Collapse all"
                      className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 16 16"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <rect x="2" y="2" width="12" height="12" rx="1" />
                        <path d="M5 8h6" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* All Files tree */}
              <div className="py-1">
                {allFilesTree.length > 0 ? (
                  allFilesTree.map((entry) => (
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
                      hunkContext="all"
                      onApproveAll={handleApproveAll}
                      onUnapproveAll={handleUnapproveAll}
                    />
                  ))
                ) : (
                  <div className="py-4 text-center">
                    <p className="text-xs text-stone-500">No files</p>
                  </div>
                )}
              </div>
            </>
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
