import { useState, useEffect, useMemo } from "react";
import type { Comparison } from "../../types";
import { useReviewStore } from "../../stores/reviewStore";
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

          {remoteInfo ? (
            <button
              onClick={() => {
                const platform = getPlatformServices();
                platform.opener.openUrl(remoteInfo.browseUrl);
              }}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 transition-colors"
              title={remoteInfo.browseUrl}
            >
              <span>{remoteInfo.name}</span>
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
            </button>
          ) : (
            <span className="text-xs text-stone-500">{repoDisplayName}</span>
          )}
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
        <div className="flex items-center gap-2 text-stone-600">
          <kbd className="inline-flex items-center gap-0.5 rounded border border-stone-800/80 bg-stone-800 px-1 py-0.5 font-mono text-xxs text-stone-500">
            <span>{"\u2318"}</span>
            <span>O</span>
          </kbd>
          <span className="text-stone-600">open repo</span>
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
