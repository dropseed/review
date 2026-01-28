import { useEffect, useState } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores/reviewStore";
import type { CommitDetail } from "../types";

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
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg max-h-[85vh] flex-col rounded-xl border border-stone-700/80 bg-stone-900 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="relative border-b border-stone-800 px-5 py-4">
          <div className="relative flex items-center justify-between">
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
              <div>
                <h2 className="text-sm font-semibold text-stone-100">
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
                </h2>
              </div>
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
          </div>
        </div>

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
              <div className="px-5 py-3">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
