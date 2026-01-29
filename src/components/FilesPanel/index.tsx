import { useState } from "react";
import { ExportModal } from "../ExportModal";
import { CommitsPanel } from "../CommitsPanel";
import { ContextMenu } from "./ContextMenu";
import { FeedbackPanel } from "./FeedbackPanel";
import { FileNode } from "./FileNode";
import { SymbolsPanel } from "./SymbolsPanel";
import {
  useFilePanelFileSystem,
  useFilePanelNavigation,
  useFilePanelApproval,
  useFilePanelFeedback,
  useFilePanelContextMenu,
} from "./hooks";
import { useReviewStore } from "../../stores/reviewStore";
import type { CommitEntry } from "../../types";

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

interface FilesPanelProps {
  onSelectCommit?: (commit: CommitEntry) => void;
}

export function FilesPanel({ onSelectCommit }: FilesPanelProps) {
  const commits = useReviewStore((s) => s.commits);
  const comparison = useReviewStore((s) => s.comparison);
  const autoApproveStaged = useReviewStore(
    (s) => s.reviewState?.autoApproveStaged ?? false,
  );
  const setAutoApproveStaged = useReviewStore((s) => s.setAutoApproveStaged);

  // Track selected commit hash locally (for highlighting in CommitsPanel)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
    null,
  );

  // File system data
  const {
    repoPath,
    allFilesLoading,
    sectionedFiles,
    allFilesTree,
    stats,
    allDirPaths,
    hunks,
    reviewState,
  } = useFilePanelFileSystem();

  // Navigation
  const {
    selectedFile,
    viewMode,
    setViewMode,
    expandedPaths,
    togglePath,
    handleSelectFile,
    expandAll,
    collapseAll,
    registerRef,
  } = useFilePanelNavigation({ sectionedFiles });

  // Approval actions
  const { handleApproveAll, handleUnapproveAll } = useFilePanelApproval();

  // Feedback panel
  const {
    notes,
    annotations,
    setReviewNotes,
    deleteAnnotation,
    notesOpen,
    setNotesOpen,
    showExportModal,
    setShowExportModal,
    hasFeedbackToExport,
    handleGoToAnnotation,
  } = useFilePanelFeedback({
    reviewState,
    rejectedCount: stats.rejected,
  });

  // Context menu
  const { contextMenu, handleContextMenu, closeContextMenu, openInSplit } =
    useFilePanelContextMenu({ repoPath });

  // Check if there are changes in the comparison
  const hasChanges =
    sectionedFiles.needsReview.length > 0 || sectionedFiles.reviewed.length > 0;

  // Handle commit selection
  const handleCommitSelect = (hash: string) => {
    setSelectedCommitHash(hash);
    const commit = commits.find((c) => c.hash === hash);
    if (commit && onSelectCommit) {
      onSelectCommit(commit);
    }
  };

  if (allFilesLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
          <span className="text-sm text-stone-500">Loading files...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={closeContextMenu}
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
        {/* View mode toggle - always show all three tabs */}
        <div className="border-b border-stone-800 px-3 py-2">
          <div
            className="flex rounded-md bg-stone-800 p-0.5"
            role="tablist"
            aria-label="File view mode"
          >
            <button
              onClick={() => setViewMode("changes")}
              role="tab"
              aria-selected={viewMode === "changes"}
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
              role="tab"
              aria-selected={viewMode === "all"}
              className={`flex-1 rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                viewMode === "all"
                  ? "bg-stone-700 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Files
            </button>
            <button
              onClick={() => setViewMode("commits")}
              role="tab"
              aria-selected={viewMode === "commits"}
              className={`flex-1 rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                viewMode === "commits"
                  ? "bg-stone-700 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Commits
            </button>
            <button
              onClick={() => setViewMode("symbols")}
              role="tab"
              aria-selected={viewMode === "symbols"}
              className={`flex-1 rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                viewMode === "symbols"
                  ? "bg-stone-700 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Symbols
            </button>
          </div>
        </div>

        {/* Auto-approve staged toggle - only for working tree comparisons */}
        {comparison?.workingTree && viewMode === "changes" && (
          <div className="flex items-center justify-between border-b border-stone-800 px-3 py-1.5">
            <label
              htmlFor="auto-approve-staged"
              className="text-xxs text-stone-400 cursor-pointer select-none"
            >
              Auto-approve staged
            </label>
            <button
              id="auto-approve-staged"
              role="switch"
              aria-checked={autoApproveStaged}
              onClick={() => setAutoApproveStaged(!autoApproveStaged)}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                autoApproveStaged ? "bg-lime-500/60" : "bg-stone-700"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  autoApproveStaged ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        )}

        {/* Panel content based on view mode */}
        {viewMode === "commits" ? (
          <CommitsPanel
            onSelectCommit={handleCommitSelect}
            selectedCommitHash={selectedCommitHash}
          />
        ) : viewMode === "symbols" ? (
          <SymbolsPanel />
        ) : (
          <>
            {/* File tree */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {viewMode === "changes" ? (
                !hasChanges ? (
                  /* Empty state when no changes exist */
                  <div className="flex flex-col items-center justify-center h-full px-6 py-12">
                    <div className="relative mb-6">
                      <div className="flex gap-1.5">
                        <div className="w-10 h-14 rounded bg-stone-800/80 border border-stone-700/50" />
                        <div className="w-10 h-14 rounded bg-stone-800/80 border border-stone-700/50" />
                      </div>
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                        <div className="w-1.5 h-0.5 bg-stone-600 rounded-full" />
                        <div className="w-1.5 h-0.5 bg-stone-600 rounded-full" />
                      </div>
                    </div>
                    <p className="text-sm font-medium text-stone-400 mb-1">
                      No changes
                    </p>
                    <p className="text-xs text-stone-500 text-center max-w-[200px]">
                      The base and compare refs are identical
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Needs Review section */}
                    <SectionHeader
                      title="Needs Review"
                      badge={stats.needsReviewFiles}
                      badgeColor="amber"
                      onExpandAll={() => expandAll(allDirPaths)}
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
                      onExpandAll={() => expandAll(allDirPaths)}
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
                )
              ) : (
                <>
                  {/* All Files header with expand/collapse */}
                  <div className="flex items-center border-b border-stone-800">
                    <div className="flex-1 px-3 py-2 text-xs font-medium text-stone-300">
                      {repoPath?.split("/").pop() || "All Files"}
                    </div>
                    {allDirPaths.size > 0 && (
                      <div className="flex items-center gap-0.5 pr-2">
                        <button
                          onClick={() => expandAll(allDirPaths)}
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
              badge={annotations.length}
              isOpen={notesOpen}
              onToggle={() => setNotesOpen(!notesOpen)}
            >
              <FeedbackPanel
                notes={notes}
                onNotesChange={setReviewNotes}
                annotations={annotations}
                onGoToAnnotation={handleGoToAnnotation}
                onDeleteAnnotation={deleteAnnotation}
              />
            </CollapsibleSection>

            {/* Actions */}
            {hasFeedbackToExport && (
              <div className="border-t border-stone-800 p-3">
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
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
