import { File as PierreFile } from "@pierre/diffs/react";
import { SimpleTooltip } from "../ui/tooltip";
import { useReviewStore } from "../../stores";
import type { DiffHunk } from "../../types";
import { isHunkTrusted } from "../../types";
import type { SupportedLanguages } from "./languageMap";

/** Returns the appropriate header background class based on hunk state */
function getHeaderBackgroundClass(
  isRejected: boolean,
  isApproved: boolean,
  isTrusted: boolean,
): string {
  if (isRejected) return "bg-rose-500/10";
  if (isApproved) return "bg-emerald-500/5 bg-stone-900/95";
  if (isTrusted) return "bg-sky-500/5 bg-stone-900/95";
  return "bg-stone-900/95";
}

interface UntrackedFileViewProps {
  content: string;
  filePath: string;
  hunks: DiffHunk[];
  theme: string;
  fontSizeCSS: string;
  /** Language override for syntax highlighting */
  language?: SupportedLanguages;
}

export function UntrackedFileView({
  content,
  filePath,
  hunks,
  theme,
  fontSizeCSS,
  language,
}: UntrackedFileViewProps) {
  const {
    reviewState,
    approveHunk,
    unapproveHunk,
    rejectHunk,
    unrejectHunk,
    hunks: allHunks,
    setSelectedFile,
  } = useReviewStore();

  // Get the synthetic hunk for this untracked file
  const hunk = hunks[0];
  const hunkState = reviewState?.hunks[hunk?.id];
  const isApproved = hunkState?.status === "approved";
  const isRejected = hunkState?.status === "rejected";
  const isTrusted =
    !hunkState?.status &&
    isHunkTrusted(hunkState, reviewState?.trustList ?? []);

  const lineCount = content.split("\n").length;

  // Move pair detection — use the store hunk (which has movePairId set
  // by batch detect_move_pairs) rather than the per-file response hunk
  const storeHunk = hunk ? allHunks.find((h) => h.id === hunk.id) : undefined;
  const pairedHunk = storeHunk?.movePairId
    ? allHunks.find((h) => h.id === storeHunk.movePairId)
    : undefined;

  return (
    <div>
      {/* Approval controls */}
      {hunk && (
        <div
          className={`sticky top-0 z-10 mb-2 flex items-center gap-3 border-b border-stone-800/50 backdrop-blur-xs p-3 ${getHeaderBackgroundClass(isRejected, isApproved, isTrusted)}`}
        >
          <span className="font-mono text-xs text-emerald-500 tabular-nums">
            + {lineCount} lines (new file)
          </span>
          {hunkState?.label && hunkState.label.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
              {hunkState.label.join(", ")}
            </span>
          )}
          {pairedHunk && (
            <SimpleTooltip content={`Jump to source in ${pairedHunk.filePath}`}>
              <button
                onClick={() => setSelectedFile(pairedHunk.filePath)}
                className="flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-400 transition-all hover:bg-sky-500/25"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                  />
                </svg>
                <span>Moved from</span>
                <span className="opacity-60">
                  {pairedHunk.filePath.split("/").pop()}
                </span>
              </button>
            </SimpleTooltip>
          )}

          {/* Action buttons - matching DiffView hunk style */}
          {isApproved ? (
            <SimpleTooltip content="Click to unapprove">
              <button
                onClick={() => unapproveHunk(hunk.id)}
                className="group flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-all hover:bg-emerald-500/25"
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Approved</span>
              </button>
            </SimpleTooltip>
          ) : isRejected ? (
            <SimpleTooltip content="Click to clear rejection">
              <button
                onClick={() => unrejectHunk(hunk.id)}
                className="group flex items-center gap-1.5 rounded-md bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-300 transition-all hover:bg-rose-500/25"
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
                <span>Rejected</span>
              </button>
            </SimpleTooltip>
          ) : (
            <div className="flex items-center rounded-md border border-stone-700/50 overflow-hidden">
              <SimpleTooltip content="Reject this change">
                <button
                  onClick={() => rejectHunk(hunk.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-stone-400 transition-all hover:bg-rose-500/15 hover:text-rose-400"
                  aria-label="Reject change"
                >
                  <span>Reject</span>
                </button>
              </SimpleTooltip>
              <div className="w-px self-stretch bg-stone-700/50" />
              <SimpleTooltip content="Approve this change">
                <button
                  onClick={() => approveHunk(hunk.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-stone-300 transition-all hover:bg-emerald-500/15 hover:text-emerald-400"
                  aria-label="Approve change"
                >
                  <span>Approve</span>
                </button>
              </SimpleTooltip>
            </div>
          )}
        </div>
      )}

      {/* File content using pierre/diffs */}
      <PierreFile
        file={{
          name: filePath,
          contents: content,
          lang: language,
          cacheKey: `untracked:${filePath}:${content.length}`,
        }}
        options={{
          theme: {
            dark: theme,
            light: theme,
          },
          themeType: "dark",
          disableFileHeader: true,
          unsafeCSS: fontSizeCSS,
        }}
      />
    </div>
  );
}
