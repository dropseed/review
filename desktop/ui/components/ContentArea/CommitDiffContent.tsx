import { PatchDiff } from "@pierre/diffs/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import type { CommitDetail } from "../../types";

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

/** Split a multi-file unified diff into individual per-file patches */
function splitPatch(patch: string): string[] {
  const parts: string[] = [];
  const lines = patch.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0) {
        parts.push(current.join("\n"));
      }
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    parts.push(current.join("\n"));
  }
  return parts;
}

function statusIcon(status: string): ReactNode {
  switch (status) {
    case "added":
      return <span className="text-status-added">A</span>;
    case "deleted":
      return <span className="text-status-deleted">D</span>;
    case "renamed":
      return <span className="text-status-renamed">R</span>;
    case "copied":
      return <span className="text-status-renamed">C</span>;
    default:
      return <span className="text-status-modified">M</span>;
  }
}

interface CommitDiffContentProps {
  hash: string;
}

export function CommitDiffContent({ hash }: CommitDiffContentProps): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);
  const diffViewMode = useReviewStore((s) => s.diffViewMode);
  const setViewingCommitHash = useReviewStore((s) => s.setViewingCommitHash);
  const effectiveDiffStyle = diffViewMode === "unified" ? "unified" : "split";
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filePatches = useMemo(
    () => (detail?.diff ? splitPatch(detail.diff) : []),
    [detail?.diff],
  );

  useEffect(() => {
    if (!hash || !repoPath) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setDetail(null);

    getApiClient()
      .getCommitDetail(repoPath, hash)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hash, repoPath]);

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-edge/60 bg-surface sticky top-0 z-10">
        <button
          type="button"
          onClick={() => setViewingCommitHash(null)}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg-secondary"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-raised ring-1 ring-edge-default">
            <svg
              className="h-3.5 w-3.5 text-fg-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="3" x2="12" y2="9" />
              <line x1="12" y1="15" x2="12" y2="21" />
            </svg>
          </div>
          <span className="text-sm font-medium text-fg-secondary">
            Commit{" "}
            <span className="font-mono text-status-modified">
              {detail?.shortHash ?? hash.slice(0, 7)}
            </span>
          </span>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 rounded-full border-2 border-edge-default border-t-status-modified animate-spin" />
            <span className="text-xs text-fg-muted">Loading commit...</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-5">
          <div className="rounded-lg bg-status-rejected/10 border border-status-rejected/20 p-4">
            <p className="text-sm text-status-rejected">{error}</p>
          </div>
        </div>
      )}

      {/* Commit detail */}
      {detail && (
        <>
          {/* Commit message */}
          <div className="px-5 py-4 border-b border-edge/60">
            <pre className="whitespace-pre-wrap font-mono text-sm text-fg-secondary leading-relaxed">
              {detail.message}
            </pre>
          </div>

          {/* Author and date */}
          <div className="px-5 py-3 border-b border-edge/60 flex items-center gap-4 text-xs text-fg-muted">
            <div className="flex items-center gap-1.5">
              <svg
                className="h-3.5 w-3.5 text-fg-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="text-fg-secondary">{detail.author}</span>
              <span className="text-fg-faint">
                &lt;{detail.authorEmail}&gt;
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg
                className="h-3.5 w-3.5 text-fg-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{formatDate(detail.date)}</span>
            </div>
          </div>

          {/* Changed files */}
          <div className="px-5 py-3 border-b border-edge/60">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xxs font-medium text-fg-muted uppercase tracking-wide">
                Changed files
              </span>
              <span className="rounded-full bg-surface-raised px-1.5 py-0.5 text-xxs font-medium text-fg-muted tabular-nums">
                {detail.files.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {detail.files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-raised/50"
                >
                  <span className="w-4 text-center font-mono text-xxs font-bold">
                    {statusIcon(file.status)}
                  </span>
                  <span className="flex-1 truncate font-mono text-fg-secondary">
                    {file.path}
                  </span>
                  <span className="flex items-center gap-1.5 tabular-nums text-xxs">
                    {file.additions > 0 && (
                      <span className="text-diff-added">+{file.additions}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className="text-diff-removed">
                        -{file.deletions}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Diff */}
          {filePatches.map((patch, i) => (
            <div key={i} className="border-b border-edge/60 last:border-b-0">
              <PatchDiff
                patch={patch}
                options={{
                  diffStyle: effectiveDiffStyle,
                  theme: {
                    dark: codeTheme,
                    light: codeTheme,
                  },
                  themeType: "dark" as const,
                  unsafeCSS: `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${Math.round(codeFontSize * 1.5)}px; --diffs-font-family: ${codeFontFamily}; }`,
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
