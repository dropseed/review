import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Comparison, GitHubPrRef } from "../../types";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import { initLogPath, clearLog } from "../../utils/logger";
import { resolveRepoIdentity } from "../../utils/repo-identity";
import { RepoSelect } from "../ComparisonPicker/RepoSelect";
import { NewComparisonForm } from "../ComparisonPicker/NewComparisonForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface ComparisonPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledRepoPath?: string | null;
}

export function ComparisonPickerModal({
  isOpen,
  onClose,
  prefilledRepoPath,
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

  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(
    prefilledRepoPath ?? null,
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedRepoPath(prefilledRepoPath ?? null);
    }
  }, [isOpen, prefilledRepoPath]);

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

      const { routePrefix } = await resolveRepoIdentity(selectedRepoPath);

      setRepoPath(selectedRepoPath);
      initLogPath(selectedRepoPath);
      clearLog();
      addRecentRepository(selectedRepoPath);

      setActiveReviewKey({
        repoPath: selectedRepoPath,
        comparisonKey: comparison.key,
      });
      await ensureReviewExists(selectedRepoPath, comparison, githubPr);

      navigate(`/${routePrefix}/review/${comparison.key}`);
      onClose();
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl rounded-xl p-0">
        <DialogHeader>
          <DialogTitle>New Review</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-5 space-y-5">
          <div>
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Repository
            </label>
            <RepoSelect
              value={selectedRepoPath}
              onChange={setSelectedRepoPath}
              recentRepos={recentRepositories}
              onOpenRepository={handleOpenRepository}
            />
          </div>

          <div className="border-t border-stone-800/60" />

          <div>
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Comparison
            </label>
            {selectedRepoPath ? (
              <NewComparisonForm
                repoPath={selectedRepoPath}
                onSelectReview={handleSelectComparison}
                existingComparisonKeys={existingComparisonKeys}
              />
            ) : (
              <div className="flex flex-nowrap items-center gap-3 rounded-xl border border-stone-800/60 bg-gradient-to-br from-stone-900/60 to-stone-950/80 px-5 py-4 shadow-inner shadow-black/20 min-h-[58px]">
                <span className="text-sm text-stone-600">
                  Select a repository to choose branches
                </span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
