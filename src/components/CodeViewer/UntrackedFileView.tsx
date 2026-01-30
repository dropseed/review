import { File as PierreFile } from "@pierre/diffs/react";
import { SimpleTooltip } from "../ui/tooltip";
import { useReviewStore } from "../../stores/reviewStore";
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
  if (isApproved) return "bg-lime-500/5 bg-stone-900/95";
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
  const { reviewState, approveHunk, unapproveHunk, rejectHunk, unrejectHunk } =
    useReviewStore();

  // Get the synthetic hunk for this untracked file
  const hunk = hunks[0];
  const hunkState = reviewState?.hunks[hunk?.id];
  const isApproved = hunkState?.status === "approved";
  const isRejected = hunkState?.status === "rejected";
  const isTrusted =
    !hunkState?.status &&
    isHunkTrusted(hunkState, reviewState?.trustList ?? []);

  const lineCount = content.split("\n").length;

  return (
    <div>
      {/* Approval controls */}
      {hunk && (
        <div
          className={`sticky top-0 z-10 mb-2 flex items-center gap-3 border-b border-stone-800/50 backdrop-blur-sm p-3 ${getHeaderBackgroundClass(isRejected, isApproved, isTrusted)}`}
        >
          <span className="font-mono text-xs text-emerald-500 tabular-nums">
            + {lineCount} lines (new file)
          </span>
          {hunkState?.label && hunkState.label.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              {hunkState.label.join(", ")}
            </span>
          )}

          {/* Action buttons - matching DiffView hunk style */}
          {isApproved ? (
            <SimpleTooltip content="Click to unapprove">
              <button
                onClick={() => unapproveHunk(hunk.id)}
                className="group flex items-center gap-1.5 rounded-md bg-lime-500/15 px-2.5 py-1 text-xs font-medium text-lime-400 transition-all hover:bg-lime-500/25"
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
                className="group flex items-center gap-1.5 rounded-md bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-400 transition-all hover:bg-rose-500/25"
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
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-stone-300 transition-all hover:bg-lime-500/15 hover:text-lime-400"
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
      <div key={language}>
        <PierreFile
          file={{
            name: filePath,
            contents: content,
            lang: language,
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
    </div>
  );
}
