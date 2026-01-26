import { useMemo, useState, useEffect } from "react";
import type { FileEntry, ReviewState } from "../types";
import { useReviewStore } from "../stores/reviewStore";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { platform } from "@tauri-apps/plugin-os";
import { save } from "@tauri-apps/plugin-dialog";

interface ReviewFilePanelProps {
  files: FileEntry[];
  reviewState: ReviewState | null;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onRevealInTree: (path: string) => void;
  hunks: Array<{ id: string; filePath: string }>;
}

interface FileReviewStatus {
  path: string;
  name: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  reviewedHunks: number;
  rejectedHunks: number;
  totalHunks: number;
  isComplete: boolean;
}

// Get all changed files with their review status
function getChangedFilesWithStatus(
  files: FileEntry[],
  reviewState: ReviewState | null,
  hunks: Array<{ id: string; filePath: string }>,
): FileReviewStatus[] {
  const changedFiles: FileReviewStatus[] = [];

  const collectChanged = (entries: FileEntry[]) => {
    for (const entry of entries) {
      if (
        entry.status &&
        !entry.isDirectory &&
        ["added", "modified", "deleted", "renamed", "untracked"].includes(
          entry.status,
        )
      ) {
        // Count hunks for this file
        const fileHunks = hunks.filter((h) => h.filePath === entry.path);
        const totalHunks = fileHunks.length;

        // Count reviewed hunks (approved or rejected)
        const reviewedHunks = fileHunks.filter(
          (h) => reviewState?.hunks[h.id]?.approvedVia,
        ).length;

        // Count rejected hunks
        const rejectedHunks = fileHunks.filter(
          (h) => reviewState?.hunks[h.id]?.rejected,
        ).length;

        // File is complete if all hunks are either approved or rejected
        const decidedHunks = reviewedHunks + rejectedHunks;

        changedFiles.push({
          path: entry.path,
          name: entry.name,
          status: entry.status as
            | "added"
            | "modified"
            | "deleted"
            | "renamed"
            | "untracked",
          reviewedHunks,
          rejectedHunks,
          totalHunks,
          isComplete: totalHunks > 0 ? decidedHunks === totalHunks : false,
        });
      }
      if (entry.children) {
        collectChanged(entry.children);
      }
    }
  };

  collectChanged(files);
  return changedFiles;
}

// Status styling
const STATUS_STYLES = {
  added: { letter: "A", color: "text-lime-400", bg: "bg-lime-500/10" },
  modified: { letter: "M", color: "text-amber-400", bg: "bg-amber-500/10" },
  deleted: { letter: "D", color: "text-rose-400", bg: "bg-rose-500/10" },
  renamed: { letter: "R", color: "text-sky-400", bg: "bg-sky-500/10" },
  untracked: { letter: "U", color: "text-stone-400", bg: "bg-stone-500/10" },
};

interface ContextMenuState {
  x: number;
  y: number;
  file: FileReviewStatus;
  fullPath: string;
  revealLabel: string;
}

function ContextMenu({
  menu,
  onClose,
  onRevealInTree,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onRevealInTree: (path: string) => void;
}) {
  useEffect(() => {
    const handleClick = () => onClose();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const handleCopyPath = async () => {
    await writeText(menu.fullPath);
    onClose();
  };

  const handleReveal = async () => {
    await revealItemInDir(menu.fullPath);
    onClose();
  };

  const handleOpenInVSCode = async () => {
    await openUrl(`vscode://file${menu.fullPath}`);
    onClose();
  };

  const handleRevealInTree = () => {
    onRevealInTree(menu.file.path);
    onClose();
  };

  return (
    <div
      className="fixed z-50 min-w-[160px] rounded border border-stone-700 bg-stone-800 py-1 shadow-lg"
      style={{ top: menu.y, left: menu.x }}
    >
      <button
        onClick={handleOpenInVSCode}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
        Open in VS Code
      </button>
      <button
        onClick={handleRevealInTree}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h16M4 18h7"
          />
        </svg>
        Reveal in Files Panel
      </button>
      <div className="my-1 h-px bg-stone-700" />
      <button
        onClick={handleCopyPath}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        Copy Path
      </button>
      <button
        onClick={handleReveal}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        {menu.revealLabel}
      </button>
    </div>
  );
}

function FileRow({
  file,
  isSelected,
  onSelect,
  onApproveAll,
  onUnapproveAll,
  onContextMenu,
}: {
  file: FileReviewStatus;
  isSelected: boolean;
  onSelect: () => void;
  onApproveAll: () => void;
  onUnapproveAll: () => void;
  onContextMenu: (e: React.MouseEvent, file: FileReviewStatus) => void;
}) {
  const style = STATUS_STYLES[file.status] ?? {
    letter: "?",
    color: "text-stone-400",
    bg: "bg-stone-500/10",
  };

  return (
    <button
      onClick={onSelect}
      onContextMenu={(e) => onContextMenu(e, file)}
      className={`
        group flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm
        transition-colors border-l-2
        ${
          isSelected
            ? "border-l-lime-500 bg-stone-800"
            : "border-l-transparent hover:bg-stone-800/50"
        }
      `}
    >
      {/* Status letter */}
      <span className={`font-mono text-xs ${style.color}`}>{style.letter}</span>

      {/* File name */}
      <span
        className={`flex-1 truncate font-mono text-xs ${isSelected ? "text-stone-100" : "text-stone-300"}`}
      >
        {file.path}
      </span>

      {/* Progress */}
      {file.totalHunks > 0 && (
        <span className="font-mono text-xs text-stone-500">
          {file.reviewedHunks + file.rejectedHunks}/{file.totalHunks}
          {file.rejectedHunks > 0 && (
            <span className="text-rose-400 ml-1">
              ({file.rejectedHunks} rejected)
            </span>
          )}
        </span>
      )}

      {/* Quick approve/unapprove toggle */}
      {file.totalHunks > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (file.isComplete) {
              onUnapproveAll();
            } else {
              onApproveAll();
            }
          }}
          className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-stone-700 ${
            file.isComplete
              ? "text-stone-400 hover:text-rose-400"
              : "text-stone-400 hover:text-lime-400"
          }`}
          title={file.isComplete ? "Unapprove all hunks" : "Approve all hunks"}
        >
          {file.isComplete ? (
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              className="h-3.5 w-3.5"
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
          )}
        </button>
      )}

      {/* Complete indicator */}
      {file.isComplete && (
        <svg
          className="h-3.5 w-3.5 text-lime-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
    </button>
  );
}

function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-stone-800">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-400 hover:bg-stone-800/50"
      >
        <svg
          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        {title}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function ReviewFilePanel({
  files,
  reviewState,
  selectedFile,
  onSelectFile,
  onRevealInTree,
  hunks,
}: ReviewFilePanelProps) {
  const {
    repoPath,
    setReviewNotes,
    completeReview,
    approveAllFileHunks,
    unapproveAllFileHunks,
    exportRejectionFeedback,
  } = useReviewStore();
  const [notesOpen, setNotesOpen] = useState(false);
  const [platformName, setPlatformName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Detect platform on mount
  useEffect(() => {
    setPlatformName(platform());
  }, []);

  const handleContextMenu = (e: React.MouseEvent, file: FileReviewStatus) => {
    e.preventDefault();
    const fullPath = `${repoPath}/${file.path}`;
    const revealLabel =
      platformName === "macos"
        ? "Reveal in Finder"
        : platformName === "windows"
          ? "Reveal in Explorer"
          : "Reveal in Files";
    setContextMenu({ x: e.clientX, y: e.clientY, file, fullPath, revealLabel });
  };

  const changedFiles = useMemo(
    () => getChangedFilesWithStatus(files, reviewState, hunks),
    [files, reviewState, hunks],
  );

  // Separate into reviewed (complete) and pending (incomplete)
  const { reviewed, pending } = useMemo(() => {
    const reviewed: FileReviewStatus[] = [];
    const pending: FileReviewStatus[] = [];

    for (const file of changedFiles) {
      if (file.isComplete) {
        reviewed.push(file);
      } else {
        pending.push(file);
      }
    }

    return { reviewed, pending };
  }, [changedFiles]);

  const totalFiles = changedFiles.length;
  const reviewedCount = reviewed.length;

  // Count total rejections across all hunks
  const totalRejections = useMemo(() => {
    if (!reviewState) return 0;
    return Object.values(reviewState.hunks).filter((h) => h.rejected).length;
  }, [reviewState]);

  // Export feedback handler
  const handleExportFeedback = async () => {
    const feedback = exportRejectionFeedback();
    if (!feedback) return;

    // Generate markdown content
    const lines = [
      `# Review Feedback`,
      ``,
      `**Comparison:** ${feedback.comparison.key}`,
      `**Exported:** ${new Date(feedback.exportedAt).toLocaleString()}`,
      `**Total Rejections:** ${feedback.rejections.length}`,
      ``,
      `---`,
      ``,
    ];

    for (const rejection of feedback.rejections) {
      lines.push(`## ${rejection.filePath}`);
      lines.push(``);
      if (rejection.notes) {
        lines.push(`**Feedback:** ${rejection.notes}`);
        lines.push(``);
      }
      lines.push("```diff");
      lines.push(rejection.content);
      lines.push("```");
      lines.push(``);
    }

    const content = lines.join("\n");

    try {
      // Try to save to file
      const filePath = await save({
        defaultPath: `review-feedback-${Date.now()}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        // Write using Tauri invoke
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_text_file", { path: filePath, contents: content });
      }
    } catch {
      // Fallback to clipboard
      await writeText(content);
    }
  };

  if (totalFiles === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
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
    );
  }

  return (
    <>
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRevealInTree={onRevealInTree}
        />
      )}
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-stone-800 px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-stone-400">Files</span>
            <div className="flex items-center gap-2">
              {totalRejections > 0 && (
                <span className="font-mono text-rose-400">
                  {totalRejections} rejected
                </span>
              )}
              <span className="font-mono text-stone-500">
                {reviewedCount}/{totalFiles}
              </span>
            </div>
          </div>
          <div className="mt-1.5 progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${(reviewedCount / totalFiles) * 100}%` }}
            />
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {/* Reviewed files */}
          {reviewed.length > 0 && (
            <div className="mb-1">
              <div className="px-3 py-1 text-xs font-medium text-lime-500">
                Reviewed ({reviewed.length})
              </div>
              {reviewed.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onSelect={() => onSelectFile(file.path)}
                  onApproveAll={() => approveAllFileHunks(file.path)}
                  onUnapproveAll={() => unapproveAllFileHunks(file.path)}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          )}

          {/* Review line divider */}
          {reviewed.length > 0 && pending.length > 0 && (
            <div className="mx-3 my-2 flex items-center gap-2">
              <div className="h-px flex-1 bg-stone-700" />
              <span className="text-[10px] text-stone-500">review line</span>
              <div className="h-px flex-1 bg-stone-700" />
            </div>
          )}

          {/* Pending files */}
          {pending.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-medium text-stone-500">
                Pending ({pending.length})
              </div>
              {pending.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onSelect={() => onSelectFile(file.path)}
                  onApproveAll={() => approveAllFileHunks(file.path)}
                  onUnapproveAll={() => unapproveAllFileHunks(file.path)}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          )}

          {/* All done */}
          {pending.length === 0 && reviewed.length > 0 && (
            <div className="flex flex-col items-center py-6 text-center">
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
              <p className="text-sm text-lime-400">All files reviewed</p>
            </div>
          )}
        </div>

        {/* Notes */}
        <CollapsibleSection
          title="Notes"
          isOpen={notesOpen}
          onToggle={() => setNotesOpen(!notesOpen)}
        >
          <textarea
            placeholder="Add review notes..."
            className="input h-20 w-full resize-none text-xs"
            value={reviewState?.notes || ""}
            onChange={(e) => setReviewNotes(e.target.value)}
          />
        </CollapsibleSection>

        {/* Actions */}
        <div className="border-t border-stone-800 p-3 space-y-2">
          {reviewState?.completedAt ? (
            <div className="rounded bg-lime-500/10 px-3 py-2 text-center text-xs text-lime-400">
              Completed {new Date(reviewState.completedAt).toLocaleDateString()}
            </div>
          ) : (
            <button
              onClick={() => completeReview()}
              disabled={reviewedCount < totalFiles}
              className={`btn w-full text-xs ${
                reviewedCount >= totalFiles
                  ? "btn-primary"
                  : "cursor-not-allowed bg-stone-800 text-stone-500"
              }`}
            >
              {reviewedCount < totalFiles
                ? `${totalFiles - reviewedCount} remaining`
                : "Complete Review"}
            </button>
          )}

          {/* Export feedback button */}
          {totalRejections > 0 && (
            <button
              onClick={handleExportFeedback}
              className="btn w-full text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20"
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
              Export Feedback ({totalRejections})
            </button>
          )}
        </div>
      </div>
    </>
  );
}
