import { File as PierreFile } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores/reviewStore";
import type { DiffHunk } from "../../types";
import { isHunkTrusted } from "../../types";
import { detectLanguage } from "./languageMap";

interface UntrackedFileViewProps {
  content: string;
  filePath: string;
  hunks: DiffHunk[];
  theme: string;
  fontSizeCSS: string;
}

export function UntrackedFileView({
  content,
  filePath,
  hunks,
  theme,
  fontSizeCSS,
}: UntrackedFileViewProps) {
  const { reviewState, approveHunk, unapproveHunk, rejectHunk, unrejectHunk } =
    useReviewStore();
  const language = detectLanguage(filePath, content);

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
          className={`sticky top-0 z-10 mb-2 flex items-center gap-3 border-b border-stone-800/50 backdrop-blur-sm p-3 ${
            isRejected
              ? "bg-rose-500/10"
              : isApproved
                ? "bg-lime-500/5 bg-stone-900/95"
                : isTrusted
                  ? "bg-sky-500/5 bg-stone-900/95"
                  : "bg-stone-900/95"
          }`}
        >
          <span className="font-mono text-xs text-emerald-500 tabular-nums">
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
              <span className="text-xxs">Rejected</span>
            </button>
          ) : !isApproved ? (
            <button
              onClick={() => rejectHunk(hunk.id)}
              className="rounded-full bg-stone-700/50 p-1.5 text-stone-400 transition-all hover:bg-rose-500/20 hover:text-rose-400"
              title="Reject this change"
              aria-label="Reject change"
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
              <span className="text-xxs opacity-60">approved</span>
            </button>
          ) : !isRejected ? (
            <button
              onClick={() => approveHunk(hunk.id)}
              className="rounded-full bg-stone-700/50 px-3 py-1 text-xs font-medium text-stone-300 transition-all hover:bg-lime-500/20 hover:text-lime-400"
            >
              Approve
            </button>
          ) : null}
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
