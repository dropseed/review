import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Comparison } from "../types";
import { useReviewStore } from "../stores";
import { initLogPath, clearLog } from "../utils/logger";
import { resolveRepoIdentity } from "../utils/repo-identity";
import { NewComparisonForm } from "./ComparisonPicker/NewComparisonForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface ComparisonPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledRepoPath?: string | null;
  onOpenRepo: () => Promise<void>;
}

export function ComparisonPickerModal({
  isOpen,
  onClose,
  prefilledRepoPath,
  onOpenRepo,
}: ComparisonPickerModalProps) {
  const navigate = useNavigate();
  const savedReviews = useReviewStore((s) => s.savedReviews);
  const recentRepositories = useReviewStore((s) => s.recentRepositories);
  const setRepoPath = useReviewStore((s) => s.setRepoPath);
  const addRecentRepository = useReviewStore((s) => s.addRecentRepository);
  const setActiveReviewKey = useReviewStore((s) => s.setActiveReviewKey);
  const ensureReviewExists = useReviewStore((s) => s.ensureReviewExists);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);

  const existingComparisonKeys = savedReviews.map((r) => r.comparison.key);

  // Internal step state: null = repo selection, string = comparison selection for that repo
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(
    prefilledRepoPath ?? null,
  );

  // Reset step when modal opens/closes or prefilled repo changes
  useEffect(() => {
    if (isOpen) {
      setSelectedRepoPath(prefilledRepoPath ?? null);
    }
  }, [isOpen, prefilledRepoPath]);

  const handleOpenRepoAndClose = useCallback(async () => {
    onClose();
    await onOpenRepo();
  }, [onClose, onOpenRepo]);

  const handleSelectComparison = useCallback(
    async (comparison: Comparison) => {
      if (!selectedRepoPath) return;

      const { routePrefix } = await resolveRepoIdentity(selectedRepoPath);

      // Activate the repo in the store
      setRepoPath(selectedRepoPath);
      initLogPath(selectedRepoPath);
      clearLog();
      addRecentRepository(selectedRepoPath);

      // Set the active review and create the review file on disk
      setActiveReviewKey({
        repoPath: selectedRepoPath,
        comparisonKey: comparison.key,
      });
      await ensureReviewExists(selectedRepoPath, comparison);

      // Navigate to the review route
      navigate(`/${routePrefix}/review/${comparison.key}`);
      onClose();

      // Refresh global reviews so the new review appears in the sidebar
      loadGlobalReviews();
    },
    [
      selectedRepoPath,
      setRepoPath,
      addRecentRepository,
      setActiveReviewKey,
      ensureReviewExists,
      loadGlobalReviews,
      navigate,
      onClose,
    ],
  );

  const showRepoStep = selectedRepoPath === null;
  const canGoBack = prefilledRepoPath == null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl rounded-xl p-0">
        <DialogHeader>
          <DialogTitle>
            {showRepoStep ? (
              "New Review"
            ) : (
              <span className="flex items-center gap-2">
                {canGoBack && (
                  <button
                    onClick={() => setSelectedRepoPath(null)}
                    className="flex items-center justify-center w-6 h-6 rounded-md
                               hover:bg-stone-800/60 transition-colors text-stone-400 hover:text-stone-200"
                    aria-label="Back to repository selection"
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
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                )}
                New Review
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {showRepoStep ? (
          /* Step 1: Repository selection */
          <div className="px-4 py-4">
            <p className="mb-3 text-xs text-stone-500">Choose a repository:</p>

            {/* Recent repositories */}
            {recentRepositories.length > 0 && (
              <div className="space-y-0.5 mb-3">
                {recentRepositories.map((repo) => (
                  <button
                    key={repo.path}
                    onClick={() => setSelectedRepoPath(repo.path)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left
                               text-xs text-stone-400 hover:bg-stone-800/50 hover:text-stone-200
                               transition-colors"
                  >
                    <svg
                      className="h-3.5 w-3.5 text-stone-600 shrink-0"
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
                    <span className="truncate font-mono">{repo.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Open Repository button */}
            <button
              onClick={handleOpenRepoAndClose}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg
                         text-xs text-stone-300 hover:bg-stone-800/50 transition-colors
                         border border-stone-800/60 border-dashed"
            >
              <svg
                className="h-3.5 w-3.5 text-stone-500"
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
              <span>Open Repository...</span>
              <kbd className="ml-auto text-2xs text-stone-600 font-mono">
                {"\u2318"}O
              </kbd>
            </button>
          </div>
        ) : (
          /* Step 2: Comparison selection */
          <div className="px-4 py-4">
            <p className="mb-3 text-xs text-stone-500">
              Select a base and compare for{" "}
              <span className="font-mono text-stone-400">
                {selectedRepoPath?.split("/").pop()}
              </span>
              :
            </p>
            <NewComparisonForm
              repoPath={selectedRepoPath!}
              onSelectReview={handleSelectComparison}
              existingComparisonKeys={existingComparisonKeys}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
