import { useMemo } from "react";
import type { ThemedToken } from "shiki";
import type { DiffHunk, HunkState } from "../../../types";
import {
  useHighlighter,
  getLanguageFromFilename,
} from "../../../hooks/useHighlighter";

interface HunkPreviewProps {
  hunk: DiffHunk;
  hunkState?: HunkState;
  /** Show compact single-line preview vs expanded */
  compact?: boolean;
  /** Highlight as selected/current */
  highlighted?: boolean;
}

/** Returns the border class for a hunk based on its status */
function getStatusBorderClass(status: string | undefined): string {
  if (status === "approved") return "border-l-2 border-l-status-approved/70";
  if (status === "rejected") return "border-l-2 border-l-status-rejected/70";
  return "";
}

/** Status badge with icon for approved/rejected hunks */
function StatusBadge({ status }: { status: "approved" | "rejected" }) {
  const isApproved = status === "approved";
  return (
    <span
      className={`flex items-center gap-1 text-xxs ${isApproved ? "text-status-approved" : "text-status-rejected"}`}
    >
      <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        {isApproved ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        )}
      </svg>
      {isApproved ? "Approved" : "Rejected"}
    </span>
  );
}

/** Tokenize all changed lines in a hunk using Shiki */
function useTokenizedLines(hunk: DiffHunk): Map<number, ThemedToken[]> | null {
  const { highlighter } = useHighlighter();

  return useMemo(() => {
    if (!highlighter) return null;

    const lang = getLanguageFromFilename(hunk.filePath);
    if (!lang) return null;

    const changedLines = hunk.lines.filter(
      (l) => l.type === "added" || l.type === "removed",
    );

    // Tokenize all lines as a single block for better context
    const code = changedLines.map((l) => l.content).join("\n");
    try {
      const result = highlighter.codeToTokens(code, {
        lang,
        theme: "github-dark",
      });
      const map = new Map<number, ThemedToken[]>();
      for (let i = 0; i < result.tokens.length; i++) {
        map.set(i, result.tokens[i]);
      }
      return map;
    } catch {
      return null;
    }
  }, [highlighter, hunk]);
}

function HighlightedLine({ tokens }: { tokens: ThemedToken[] }) {
  return (
    <span className="whitespace-pre">
      {tokens.map((token, i) => (
        <span key={i} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </span>
  );
}

/**
 * Reusable preview of a hunk's changed lines.
 * Shows file path and the actual diff content with syntax highlighting.
 */
export function HunkPreview({
  hunk,
  hunkState,
  highlighted = false,
}: HunkPreviewProps) {
  const changedLines = hunk.lines.filter(
    (l) => l.type === "added" || l.type === "removed",
  );

  const tokenMap = useTokenizedLines(hunk);
  const status = hunkState?.status;
  return (
    <div
      className={`rounded-md border transition-colors ${
        highlighted
          ? "border-status-modified/50 bg-status-modified/5"
          : "border-edge-default/50 bg-surface-raised/30"
      } ${getStatusBorderClass(status)}`}
    >
      {/* File path header */}
      <div className="flex items-center gap-2 border-b border-edge-default/30 px-3 py-1.5">
        <span className="text-xs font-medium text-fg-muted truncate flex-1">
          {hunk.filePath}
        </span>
        {status === "approved" && <StatusBadge status="approved" />}
        {status === "rejected" && <StatusBadge status="rejected" />}
        {hunkState?.label && hunkState.label.length > 0 && (
          <span className="rounded bg-surface-hover/50 px-1.5 py-0.5 text-xxs text-fg-muted">
            {hunkState.label[0]}
          </span>
        )}
      </div>

      {/* Changed lines */}
      <div className="font-mono text-xs overflow-x-auto">
        {changedLines.map((line, i) => {
          const tokens = tokenMap?.get(i);
          return (
            <div
              key={i}
              className={`flex items-start px-3 py-0.5 ${
                line.type === "added"
                  ? "bg-status-approved/10"
                  : "bg-status-rejected/10"
              }`}
            >
              <span
                className={`w-4 flex-shrink-0 select-none opacity-50 ${
                  line.type === "added"
                    ? "text-status-approved"
                    : "text-status-rejected"
                }`}
              >
                {line.type === "added" ? "+" : "-"}
              </span>
              {tokens ? (
                <HighlightedLine tokens={tokens} />
              ) : (
                <span
                  className={`whitespace-pre ${
                    line.type === "added"
                      ? "text-status-approved"
                      : "text-status-rejected"
                  }`}
                >
                  {line.content}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
