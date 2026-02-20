import { type ReactNode, useState, useCallback } from "react";
import type { Comparison, GitHubPrRef } from "../types";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
import { ComparisonPicker } from "./ComparisonPicker/ComparisonPicker";

interface NewReviewViewProps {
  onNewReview: (
    path: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ) => Promise<void>;
}

export function NewReviewView({ onNewReview }: NewReviewViewProps): ReactNode {
  const savedReviews = useReviewStore((s) => s.savedReviews);
  const recentRepositories = useReviewStore((s) => s.recentRepositories);

  const existingComparisonKeys = savedReviews.map((r) => r.comparison.key);

  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);

  const handleOpenRepository = useCallback(async () => {
    const platform = getPlatformServices();
    const apiClient = getApiClient();
    try {
      const selected = await platform.dialogs.openDirectory({
        title: "Open Repository",
      });
      if (!selected) return;

      const isRepo = await apiClient.isGitRepo(selected);
      if (!isRepo) {
        await platform.dialogs.message(
          "The selected directory is not a git repository.",
          { title: "Not a Git Repository", kind: "error" },
        );
        return;
      }

      setSelectedRepoPath(selected);
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, []);

  const handleSelectComparison = useCallback(
    async (comparison: Comparison, githubPr?: GitHubPrRef) => {
      if (!selectedRepoPath) return;
      await onNewReview(selectedRepoPath, comparison, githubPr);
    },
    [selectedRepoPath, onNewReview],
  );

  return (
    <div
      className="flex h-full items-center justify-center"
      data-tauri-drag-region
    >
      <div className="w-full max-w-xl px-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-lg font-medium text-fg-secondary">
              New Review
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              Select a repository and choose branches to compare
            </p>
          </div>

          {/* Repository section */}
          <div>
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Repository
            </label>

            {selectedRepoPath ? (
              <div className="flex items-center gap-2 rounded-lg border border-edge-default/50 bg-surface-raised/50 px-3 py-2.5">
                <svg
                  className="h-4 w-4 text-fg-muted shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                  />
                </svg>
                <span className="truncate font-mono text-sm text-fg-secondary">
                  {selectedRepoPath.split("/").pop()}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRepoPath(null)}
                  className="ml-auto text-2xs text-fg-muted hover:text-fg-secondary transition-colors duration-100"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentRepositories.length > 0 && (
                  <ul className="space-y-0.5">
                    {recentRepositories.map((repo) => (
                      <li key={repo.path}>
                        <button
                          type="button"
                          onClick={() => setSelectedRepoPath(repo.path)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5
                                     text-sm text-fg-secondary
                                     hover:bg-surface-raised/70 transition-colors duration-100
                                     focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring/50"
                        >
                          <svg
                            className="h-3.5 w-3.5 text-fg-faint shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                            />
                          </svg>
                          <span className="truncate font-mono">
                            {repo.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={handleOpenRepository}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-edge/60
                             px-3 py-2.5 text-sm text-fg-muted
                             hover:border-edge-strong/60 hover:bg-surface-raised/30 hover:text-fg-secondary
                             transition-colors duration-100
                             focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring/50"
                >
                  <svg
                    className="h-3.5 w-3.5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
                    />
                  </svg>
                  <span>Open a folder…</span>
                  <kbd className="ml-auto text-2xs text-fg-faint font-mono">
                    {"\u2318"}O
                  </kbd>
                </button>
              </div>
            )}
          </div>

          {/* Comparison section */}
          <div>
            {selectedRepoPath ? (
              <ComparisonPicker
                repoPath={selectedRepoPath}
                onSelectReview={handleSelectComparison}
                existingComparisonKeys={existingComparisonKeys}
              />
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-edge/60 bg-gradient-to-br from-surface-panel/60 to-surface/80 px-5 py-4 shadow-inner shadow-black/20 min-h-[58px]">
                <span className="text-sm text-fg-faint">
                  Select a repository to choose branches
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
