import { PatchDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores/reviewStore";
import type { CommitDetail } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface CommitDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  commitHash: string | null;
}

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
      // Only collect lines after we've seen the first "diff --git"
      current.push(line);
    }
    // Skip any leading lines before the first "diff --git" (e.g. commit hash)
  }
  if (current.length > 0) {
    parts.push(current.join("\n"));
  }
  return parts;
}

function statusIcon(status: string) {
  switch (status) {
    case "added":
      return <span className="text-emerald-400">A</span>;
    case "deleted":
      return <span className="text-rose-400">D</span>;
    case "renamed":
      return <span className="text-sky-400">R</span>;
    case "copied":
      return <span className="text-sky-400">C</span>;
    default:
      return <span className="text-amber-400">M</span>;
  }
}

export function CommitDetailModal({
  isOpen,
  onClose,
  commitHash,
}: CommitDetailModalProps) {
  const { repoPath } = useReviewStore();
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const diffViewMode = useReviewStore((s) => s.diffViewMode);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filePatches = useMemo(
    () => (detail?.diff ? splitPatch(detail.diff) : []),
    [detail?.diff],
  );

  useEffect(() => {
    if (!isOpen || !commitHash || !repoPath) return;

    setLoading(true);
    setError(null);
    setDetail(null);

    getApiClient()
      .getCommitDetail(repoPath, commitHash)
      .then((result) => {
        setDetail(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [isOpen, commitHash, repoPath]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex w-full max-w-5xl max-h-[85vh] flex-col rounded-xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="relative px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-800 ring-1 ring-stone-700">
              <svg
                className="h-4 w-4 text-stone-400"
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
            <DialogTitle>
              Commit{" "}
              {detail ? (
                <span className="font-mono text-amber-400">
                  {detail.shortHash}
                </span>
              ) : commitHash ? (
                <span className="font-mono text-amber-400">
                  {commitHash.slice(0, 7)}
                </span>
              ) : null}
            </DialogTitle>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
          >
            <svg
              className="h-5 w-5"
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
        </DialogHeader>

        {/* Content */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="h-6 w-6 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
                <span className="text-xs text-stone-500">
                  Loading commit...
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-5">
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-4">
                <p className="text-sm text-rose-400">{error}</p>
              </div>
            </div>
          )}

          {detail && (
            <>
              {/* Commit message */}
              <div className="px-5 py-4 border-b border-stone-800/60">
                <pre className="whitespace-pre-wrap font-mono text-sm text-stone-200 leading-relaxed">
                  {detail.message}
                </pre>
              </div>

              {/* Author and date */}
              <div className="px-5 py-3 border-b border-stone-800/60 flex items-center gap-4 text-xs text-stone-400">
                <div className="flex items-center gap-1.5">
                  <svg
                    className="h-3.5 w-3.5 text-stone-500"
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
                  <span className="text-stone-300">{detail.author}</span>
                  <span className="text-stone-600">
                    &lt;{detail.authorEmail}&gt;
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg
                    className="h-3.5 w-3.5 text-stone-500"
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
              <div className="px-5 py-3 border-b border-stone-800/60">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xxs font-medium text-stone-500 uppercase tracking-wide">
                    Changed files
                  </span>
                  <span className="rounded-full bg-stone-800 px-1.5 py-0.5 text-xxs font-medium text-stone-400 tabular-nums">
                    {detail.files.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {detail.files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-stone-800/50"
                    >
                      <span className="w-4 text-center font-mono text-xxs font-bold">
                        {statusIcon(file.status)}
                      </span>
                      <span className="flex-1 truncate font-mono text-stone-300">
                        {file.path}
                      </span>
                      <span className="flex items-center gap-1.5 tabular-nums text-xxs">
                        {file.additions > 0 && (
                          <span className="text-emerald-400">
                            +{file.additions}
                          </span>
                        )}
                        {file.deletions > 0 && (
                          <span className="text-rose-400">
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
                <div
                  key={i}
                  className="border-b border-stone-800/60 last:border-b-0"
                >
                  <PatchDiff
                    patch={patch}
                    options={{
                      diffStyle: diffViewMode,
                      theme: {
                        dark: codeTheme,
                        light: codeTheme,
                      },
                      themeType: "dark" as const,
                      unsafeCSS: `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${Math.round(codeFontSize * 1.5)}px; }`,
                    }}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
