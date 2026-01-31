import { useState, useEffect, useMemo } from "react";
import type { Comparison } from "../../types";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { SimpleTooltip } from "../ui/tooltip";
import { GitStatusIndicator } from "../GitStatusIndicator";
import { SettingsModal } from "../SettingsModal";
import { SavedReviewList } from "./SavedReviewList";
import { PullRequestList } from "./PullRequestList";
import { NewComparisonForm } from "./NewComparisonForm";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface StartScreenProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
  onCloseRepo: () => void;
}

export function StartScreen({
  repoPath,
  onSelectReview,
  onCloseRepo,
}: StartScreenProps) {
  const { savedReviews, savedReviewsLoading, loadSavedReviews, deleteReview } =
    useReviewStore();
  const loadGitStatus = useReviewStore((s) => s.loadGitStatus);
  const loadRemoteInfo = useReviewStore((s) => s.loadRemoteInfo);
  const remoteInfo = useReviewStore((s) => s.remoteInfo);

  const prefersReducedMotion = usePrefersReducedMotion();

  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Load git status and remote info on mount
  useEffect(() => {
    loadGitStatus();
    loadRemoteInfo();
  }, [loadGitStatus, loadRemoteInfo]);

  // Load saved reviews on mount
  useEffect(() => {
    loadSavedReviews();
  }, [loadSavedReviews]);

  const existingComparisonKeys = useMemo(
    () => savedReviews.map((r) => r.comparison.key),
    [savedReviews],
  );

  // Repo display name: use remote name or fall back to last path segment
  const repoDisplayName = remoteInfo?.name
    ? remoteInfo.name
    : repoPath.replace(/\/+$/, "").split("/").pop() || "repo";

  return (
    <div className="flex h-screen flex-col bg-stone-950">
      {/* Header — matches ReviewView chrome */}
      <header className="flex h-12 items-center justify-between border-b border-stone-800 bg-stone-900 px-4">
        {/* Left: back arrow + repo name */}
        <div className="flex items-center gap-2">
          <SimpleTooltip content="Back to welcome">
            <button
              onClick={onCloseRepo}
              className="flex items-center justify-center w-7 h-7 rounded-md
                         text-stone-500 hover:text-stone-200 hover:bg-stone-800/60
                         transition-colors duration-100
                         focus:outline-none focus:ring-2 focus:ring-stone-500/50"
              aria-label="Back to welcome screen"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
          </SimpleTooltip>

          <span className="text-xs text-stone-500">{repoDisplayName}</span>
        </div>

        {/* Right: settings */}
        <div className="flex items-center">
          <SimpleTooltip content="Settings">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center justify-center w-7 h-7 rounded-md
                         text-stone-500 hover:text-stone-200 hover:bg-stone-800/60
                         transition-colors duration-100
                         focus:outline-none focus:ring-2 focus:ring-stone-500/50"
              aria-label="Open settings"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </SimpleTooltip>
        </div>
      </header>

      {/* Main content — scrollable, centered */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-xl mx-auto px-6 py-8">
          <SavedReviewList
            savedReviews={savedReviews}
            savedReviewsLoading={savedReviewsLoading}
            onSelectReview={onSelectReview}
            onDeleteReview={deleteReview}
            prefersReducedMotion={prefersReducedMotion}
          />

          <PullRequestList
            repoPath={repoPath}
            onSelectReview={onSelectReview}
            existingComparisonKeys={existingComparisonKeys}
            prefersReducedMotion={prefersReducedMotion}
          />

          <NewComparisonForm
            repoPath={repoPath}
            onSelectReview={onSelectReview}
            existingComparisonKeys={existingComparisonKeys}
          />
        </div>
      </main>

      {/* Status bar — matches ReviewView chrome */}
      <footer className="flex h-8 items-center justify-between border-t border-stone-800 bg-stone-900 px-4 text-2xs">
        <div className="flex items-center gap-3">
          <GitStatusIndicator />
        </div>
        <div className="flex items-center gap-3 text-stone-600">
          {remoteInfo && (
            <button
              onClick={() => {
                const platform = getPlatformServices();
                platform.opener.openUrl(remoteInfo.browseUrl);
              }}
              className="flex items-center gap-1 text-stone-500 hover:text-stone-300 transition-colors"
              title={remoteInfo.browseUrl}
            >
              {remoteInfo.browseUrl.includes("github.com") ? (
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
              ) : (
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              )}
              <span>{remoteInfo.name}</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <kbd className="inline-flex items-center gap-0.5 rounded border border-stone-800/80 bg-stone-800 px-1 py-0.5 font-mono text-xxs text-stone-500">
              <span>{"\u2318"}</span>
              <span>O</span>
            </kbd>
            <span className="text-stone-600">open repo</span>
          </div>
        </div>
      </footer>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </div>
  );
}
