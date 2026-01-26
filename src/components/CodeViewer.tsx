import { useEffect, useState, useRef, Component, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PatchDiff, File as PierreFile } from "@pierre/diffs/react";
import type {
  SupportedLanguages,
  DiffLineAnnotation,
} from "@pierre/diffs/react";
import { useReviewStore } from "../stores/reviewStore";
import { Breadcrumbs } from "./Breadcrumbs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import type { DiffHunk } from "../types";

// Map file extensions to pierre/diffs supported languages
function getLanguageFromFilename(
  filePath: string,
): SupportedLanguages | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, SupportedLanguages> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    dockerfile: "dockerfile",
    toml: "toml",
    ini: "ini",
    vue: "vue",
    svelte: "svelte",
    graphql: "graphql",
    gql: "graphql",
  };
  return ext ? langMap[ext] : undefined;
}

// Error boundary to catch rendering errors
class DiffErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[DiffErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface CodeViewerProps {
  filePath: string;
}

interface FileContent {
  content: string;
  diffPatch: string;
  hunks: DiffHunk[];
}

export function CodeViewer({ filePath }: CodeViewerProps) {
  const { comparison, repoPath } = useReviewStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [viewMode, setViewMode] = useState<"unified" | "split" | "file">(
    "unified",
  );
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    invoke<FileContent>("get_file_content", { repoPath, filePath, comparison })
      .then((result) => {
        setFileContent(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [repoPath, filePath, comparison]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
          <span className="text-stone-500">Loading file...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-6 max-w-md text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20 mx-auto">
            <svg
              className="h-6 w-6 text-rose-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="text-rose-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return null;
  }

  const hasChanges = fileContent.hunks.length > 0;
  const isUntracked = hasChanges && !fileContent.diffPatch;
  const fullPath = `${repoPath}/${filePath}`;

  const handleCopyPath = async () => {
    await writeText(fullPath);
  };

  const handleReveal = async () => {
    await revealItemInDir(fullPath);
  };

  const handleOpenInEditor = async () => {
    // Try to open with default editor (VS Code, etc.)
    try {
      await openPath(fullPath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      {/* File header with breadcrumbs */}
      <div className="flex items-center justify-between border-b border-stone-800/50 bg-stone-900 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Breadcrumbs filePath={filePath} />
          {isUntracked ? (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              New
            </span>
          ) : hasChanges ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              {fileContent.hunks.length}
            </span>
          ) : null}

          {/* File actions overflow menu */}
          <OverflowMenu>
            <button
              onClick={handleCopyPath}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy path
            </button>
            <button
              onClick={handleReveal}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              Reveal in Finder
            </button>
            <button
              onClick={handleOpenInEditor}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
              Open in editor
            </button>
          </OverflowMenu>
        </div>
        {!isUntracked && hasChanges && (
          <div className="flex items-center rounded bg-stone-800/30 p-0.5">
            <button
              onClick={() => {
                setViewMode("unified");
                setHighlightLine(null);
              }}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                viewMode === "unified"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => {
                setViewMode("split");
                setHighlightLine(null);
              }}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                viewMode === "split"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Split
            </button>
            <button
              onClick={() => {
                setViewMode("file");
                setHighlightLine(null);
              }}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                viewMode === "file"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              File
            </button>
          </div>
        )}
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto scrollbar-thin bg-stone-950">
        {isUntracked ? (
          <UntrackedFileView
            content={fileContent.content}
            filePath={filePath}
            hunks={fileContent.hunks}
          />
        ) : hasChanges && viewMode !== "file" ? (
          <DiffView
            diffPatch={fileContent.diffPatch}
            viewMode={viewMode as "unified" | "split"}
            hunks={fileContent.hunks}
            onViewInFile={(line) => {
              setViewMode("file");
              setHighlightLine(line);
            }}
          />
        ) : (
          <PlainCodeView
            content={fileContent.content}
            filePath={filePath}
            highlightLine={highlightLine}
          />
        )}
      </div>
    </div>
  );
}

function PlainCodeView({
  content,
  filePath,
  highlightLine,
}: {
  content: string;
  filePath: string;
  highlightLine?: number | null;
}) {
  const language = getLanguageFromFilename(filePath);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted line when it changes
  useEffect(() => {
    if (highlightLine && containerRef.current) {
      // Wait for render, then scroll to the line
      const timeout = setTimeout(() => {
        const lineEl = containerRef.current?.querySelector(
          `[data-line="${highlightLine}"]`,
        );
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100); // Small delay to ensure content is rendered
      return () => clearTimeout(timeout);
    }
  }, [highlightLine]);

  return (
    <div ref={containerRef}>
      <PierreFile
        file={{
          name: filePath,
          contents: content,
          lang: language,
        }}
        selectedLines={
          highlightLine
            ? { start: highlightLine, end: highlightLine, side: "additions" }
            : null
        }
        options={{
          theme: {
            dark: "github-dark",
            light: "github-light",
          },
          themeType: "dark",
          disableFileHeader: true,
        }}
      />
    </div>
  );
}

interface UntrackedFileViewProps {
  content: string;
  filePath: string;
  hunks: DiffHunk[];
}

function UntrackedFileView({
  content,
  filePath,
  hunks,
}: UntrackedFileViewProps) {
  const {
    reviewState,
    approveHunk,
    unapproveHunk,
    rejectHunk,
    unrejectHunk,
    setHunkNotes,
  } = useReviewStore();
  const [showNotesPopover, setShowNotesPopover] = useState(false);
  const language = getLanguageFromFilename(filePath);

  // Get the synthetic hunk for this untracked file
  const hunk = hunks[0];
  const hunkState = reviewState?.hunks[hunk?.id];
  const isApproved = !!hunkState?.approvedVia;
  const isRejected = !!hunkState?.rejected;
  const hasNotes = !!hunkState?.notes;

  const lineCount = content.split("\n").length;

  const handleReject = () => {
    if (hunk) {
      rejectHunk(hunk.id);
      setShowNotesPopover(true);
    }
  };

  return (
    <div>
      {/* Approval controls */}
      {hunk && (
        <div
          className={`sticky top-0 z-10 mb-2 flex items-center gap-3 border-b border-stone-800/50 backdrop-blur-sm p-3 ${
            isRejected
              ? "bg-rose-500/10"
              : isApproved
                ? "bg-lime-500/5 bg-stone-900/95"
                : "bg-stone-900/95"
          }`}
        >
          <span className="font-mono text-xs text-emerald-500">
            + {lineCount} lines (new file)
          </span>
          {hunkState?.label && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              {hunkState.label}
            </span>
          )}

          {/* Reject button */}
          {isRejected ? (
            <button
              onClick={() => unrejectHunk(hunk.id)}
              className="group flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-400 transition-all hover:bg-stone-700/50 hover:text-stone-300"
              title="Click to clear rejection"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="text-[10px]">Rejected</span>
            </button>
          ) : !isApproved ? (
            <button
              onClick={handleReject}
              className="rounded-full bg-stone-700/50 p-1.5 text-stone-400 transition-all hover:bg-rose-500/20 hover:text-rose-400"
              title="Reject this change"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          ) : null}

          {/* Approve button */}
          {isApproved ? (
            <button
              onClick={() => unapproveHunk(hunk.id)}
              className="group flex items-center gap-1.5 rounded-full bg-lime-500/15 px-2.5 py-1 text-xs font-medium text-lime-400 transition-all hover:bg-rose-500/15 hover:text-rose-400"
              title="Click to unapprove"
            >
              <svg
                className="h-3.5 w-3.5 group-hover:hidden"
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
              <svg
                className="hidden h-3.5 w-3.5 group-hover:block"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="text-[10px] opacity-60">
                {hunkState?.approvedVia}
              </span>
            </button>
          ) : !isRejected ? (
            <button
              onClick={() => approveHunk(hunk.id, "manual")}
              className="rounded-full bg-stone-700/50 px-3 py-1 text-xs font-medium text-stone-300 transition-all hover:bg-lime-500/20 hover:text-lime-400"
            >
              Approve
            </button>
          ) : null}

          {/* Notes button */}
          <div className="relative">
            <button
              onClick={() => setShowNotesPopover(!showNotesPopover)}
              className={`rounded p-1.5 transition-colors ${
                hasNotes
                  ? "text-amber-400 hover:bg-amber-500/20"
                  : "text-stone-500 hover:bg-stone-700 hover:text-stone-300"
              }`}
              title={hasNotes ? "Edit notes" : "Add notes"}
            >
              <svg
                className="h-3.5 w-3.5"
                fill={hasNotes ? "currentColor" : "none"}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                />
              </svg>
            </button>
            {showNotesPopover && (
              <NotesPopover
                notes={hunkState?.notes || ""}
                onSave={(notes) => setHunkNotes(hunk.id, notes)}
                onClose={() => setShowNotesPopover(false)}
                autoFocus
              />
            )}
          </div>
        </div>
      )}

      {/* File content using pierre/diffs */}
      <PierreFile
        file={{
          name: filePath,
          contents: content,
          lang: language,
        }}
        options={{
          theme: {
            dark: "github-dark",
            light: "github-light",
          },
          themeType: "dark",
          disableFileHeader: true,
        }}
      />
    </div>
  );
}

interface DiffViewProps {
  diffPatch: string;
  viewMode: "unified" | "split";
  hunks: DiffHunk[];
  onViewInFile?: (line: number) => void;
}

// Simple overflow menu component
function OverflowMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded p-1 text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg bg-stone-800 border border-stone-700 shadow-xl py-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Metadata for hunk annotations
interface HunkAnnotationMeta {
  hunk: DiffHunk;
  hunkState:
    | {
        label?: string[];
        approvedVia?: "manual" | "trust" | "ai";
        rejected?: boolean;
        notes?: string;
      }
    | undefined;
  pairedHunk: DiffHunk | null;
  isSource: boolean;
}

// Notes popover component
function NotesPopover({
  notes,
  onSave,
  onClose,
  autoFocus,
}: {
  notes: string;
  onSave: (notes: string) => void;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(notes);
  const valueRef = useRef(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state without triggering effect re-runs
  valueRef.current = value;

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onSave(valueRef.current);
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSave(valueRef.current);
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onSave, onClose]);

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-0 mt-1 z-30 w-64 rounded-lg bg-stone-800 border border-stone-700 shadow-xl p-2"
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add feedback or notes..."
        className="w-full h-20 bg-stone-900 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 placeholder-stone-500 resize-none focus:outline-none focus:border-amber-500/50"
      />
      <div className="flex justify-end gap-1 mt-1">
        <button
          onClick={() => {
            onSave(value);
            onClose();
          }}
          className="px-2 py-1 text-xs font-medium text-stone-300 bg-stone-700 rounded hover:bg-stone-600 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function DiffView({ diffPatch, viewMode, hunks, onViewInFile }: DiffViewProps) {
  const {
    reviewState,
    approveHunk,
    unapproveHunk,
    rejectHunk,
    unrejectHunk,
    setHunkNotes,
    hunks: allHunks,
    setSelectedFile,
  } = useReviewStore();
  const [notesPopoverHunkId, setNotesPopoverHunkId] = useState<string | null>(
    null,
  );

  // Helper to determine if hunk is deletion-only (source of move)
  const isDeletionOnly = (hunk: DiffHunk) =>
    hunk.lines.every((l) => l.type === "removed" || l.type === "context") &&
    hunk.lines.some((l) => l.type === "removed");

  // Build line annotations for each hunk - position at first changed line
  const lineAnnotations: DiffLineAnnotation<HunkAnnotationMeta>[] = hunks.map(
    (hunk) => {
      const hunkState = reviewState?.hunks[hunk.id];
      const pairedHunk = hunk.movePairId
        ? (allHunks.find((h) => h.id === hunk.movePairId) ?? null)
        : null;
      const isSource = pairedHunk ? isDeletionOnly(hunk) : false;

      // Find the first changed line (added or removed) to position annotation there
      const firstChangedLine = hunk.lines.find(
        (l) => l.type === "added" || l.type === "removed",
      );
      const lineNumber = isSource
        ? (firstChangedLine?.oldLineNumber ?? hunk.oldStart)
        : (firstChangedLine?.newLineNumber ?? hunk.newStart);

      return {
        side: isSource ? ("deletions" as const) : ("additions" as const),
        lineNumber,
        metadata: { hunk, hunkState, pairedHunk, isSource },
      };
    },
  );

  // Handle jumping to paired hunk
  const handleJumpToPair = (movePairId: string) => {
    const pairedHunk = allHunks.find((h) => h.id === movePairId);
    if (pairedHunk) {
      setSelectedFile(pairedHunk.filePath);
    }
  };

  const handleCopyHunk = async (hunk: DiffHunk) => {
    await writeText(hunk.content);
  };

  // Handle reject with notes popup
  const handleReject = (hunkId: string) => {
    rejectHunk(hunkId);
    setNotesPopoverHunkId(hunkId);
  };

  // Render annotation for each hunk
  const renderAnnotation = (
    annotation: DiffLineAnnotation<HunkAnnotationMeta>,
  ) => {
    const { hunk, hunkState, pairedHunk, isSource } = annotation.metadata!;
    const isApproved = !!hunkState?.approvedVia;
    const isRejected = !!hunkState?.rejected;
    const hasNotes = !!hunkState?.notes;
    const showNotesPopover = notesPopoverHunkId === hunk.id;

    return (
      <div
        className={`flex items-center gap-2 px-3 py-1.5 border-b border-stone-700/50 ${
          isRejected
            ? "bg-rose-500/10"
            : isApproved
              ? "bg-lime-500/5"
              : "bg-stone-800/80"
        }`}
      >
        {/* Trust labels */}
        {hunkState?.label?.map((lbl, i) => (
          <span
            key={i}
            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400"
          >
            {lbl}
          </span>
        ))}

        {/* Move indicator */}
        {pairedHunk && (
          <button
            onClick={() => handleJumpToPair(hunk.movePairId!)}
            className="flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-400 transition-all hover:bg-sky-500/25"
            title={`Jump to ${isSource ? "destination" : "source"} in ${pairedHunk.filePath}`}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {isSource ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                />
              )}
            </svg>
            <span>{isSource ? "Moved to" : "Moved from"}</span>
            <span className="opacity-60">
              {pairedHunk.filePath.split("/").pop()}
            </span>
          </button>
        )}

        {/* Reject button */}
        {isRejected ? (
          <button
            onClick={() => unrejectHunk(hunk.id)}
            className="group flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-400 transition-all hover:bg-stone-700/50 hover:text-stone-300"
            title="Click to clear rejection"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span className="text-[10px]">Rejected</span>
          </button>
        ) : !isApproved ? (
          <button
            onClick={() => handleReject(hunk.id)}
            className="rounded-full bg-stone-700/50 p-1.5 text-stone-400 transition-all hover:bg-rose-500/20 hover:text-rose-400"
            title="Reject this change"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        ) : null}

        {/* Approve/Unapprove button */}
        {isApproved ? (
          <button
            onClick={() => unapproveHunk(hunk.id)}
            className="group flex items-center gap-1.5 rounded-full bg-lime-500/15 px-2.5 py-1 text-xs font-medium text-lime-400 transition-all hover:bg-rose-500/15 hover:text-rose-400"
            title="Click to unapprove"
          >
            <svg
              className="h-3.5 w-3.5 group-hover:hidden"
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
            <svg
              className="hidden h-3.5 w-3.5 group-hover:block"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span className="text-[10px] opacity-60">
              {hunkState?.approvedVia}
            </span>
          </button>
        ) : !isRejected ? (
          <button
            onClick={() => approveHunk(hunk.id, "manual")}
            className="rounded-full bg-stone-700/50 px-3 py-1 text-xs font-medium text-stone-300 transition-all hover:bg-lime-500/20 hover:text-lime-400"
          >
            Approve
          </button>
        ) : null}

        {/* Notes button */}
        <div className="relative">
          <button
            onClick={() =>
              setNotesPopoverHunkId(showNotesPopover ? null : hunk.id)
            }
            className={`rounded p-1.5 transition-colors ${
              hasNotes
                ? "text-amber-400 hover:bg-amber-500/20"
                : "text-stone-500 hover:bg-stone-700 hover:text-stone-300"
            }`}
            title={hasNotes ? "Edit notes" : "Add notes"}
          >
            <svg
              className="h-3.5 w-3.5"
              fill={hasNotes ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
              />
            </svg>
          </button>
          {showNotesPopover && (
            <NotesPopover
              notes={hunkState?.notes || ""}
              onSave={(notes) => setHunkNotes(hunk.id, notes)}
              onClose={() => setNotesPopoverHunkId(null)}
              autoFocus
            />
          )}
        </div>

        {/* Overflow menu - pushed to far right */}
        <div className="ml-auto">
          <OverflowMenu>
            {onViewInFile && (
              <button
                onClick={() => {
                  // Find first changed line to jump to
                  const firstChanged = hunk.lines.find(
                    (l) => l.type === "added" || l.type === "removed",
                  );
                  const targetLine =
                    firstChanged?.newLineNumber ?? hunk.newStart;
                  onViewInFile(targetLine);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
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
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                View in file
              </button>
            )}
            <button
              onClick={() => handleCopyHunk(hunk)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
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
              Copy hunk
            </button>
          </OverflowMenu>
        </div>
      </div>
    );
  };

  return (
    <div className="diff-container">
      <DiffErrorBoundary
        fallback={
          <div className="p-6">
            <div className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4">
              <p className="text-rose-400">Failed to render diff view</p>
            </div>
            <div className="rounded-lg bg-stone-800/30 p-4">
              <p className="mb-2 text-sm text-stone-500">Raw patch:</p>
              <pre className="overflow-auto font-mono text-xs text-stone-300 leading-relaxed">
                {diffPatch}
              </pre>
            </div>
          </div>
        }
      >
        <PatchDiff
          patch={diffPatch}
          lineAnnotations={lineAnnotations}
          renderAnnotation={renderAnnotation}
          options={{
            diffStyle: viewMode,
            theme: {
              dark: "github-dark",
              light: "github-light",
            },
            themeType: "dark",
            diffIndicators: "bars",
            disableBackground: true,
          }}
        />
      </DiffErrorBoundary>
    </div>
  );
}
