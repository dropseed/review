import { useState } from "react";
import { useReviewStore } from "../stores/reviewStore";
import { GitStatusModal } from "./GitStatusModal";

// Branch icon component
function BranchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function GitStatusIndicator() {
  const { gitStatus } = useReviewStore();
  const [showModal, setShowModal] = useState(false);

  if (!gitStatus) {
    return null;
  }

  const stagedCount = gitStatus.staged.length;
  const unstagedCount = gitStatus.unstaged.length;
  const untrackedCount = gitStatus.untracked.length;
  const hasChanges = stagedCount > 0 || unstagedCount > 0 || untrackedCount > 0;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5
                   text-stone-400 hover:bg-stone-800 hover:text-stone-200
                   transition-colors"
        title={`Branch: ${gitStatus.currentBranch}${hasChanges ? " (has changes)" : ""}`}
      >
        <BranchIcon className="h-3 w-3 text-stone-500" />
        <span className="font-medium text-stone-300 max-w-[7rem] truncate">
          {gitStatus.currentBranch}
        </span>

        {/* Status badges - more compact for status bar */}
        {stagedCount > 0 && (
          <span
            className="ml-1 font-mono text-xxs font-medium tabular-nums text-lime-400"
            title={`${stagedCount} staged change${stagedCount !== 1 ? "s" : ""}`}
          >
            +{stagedCount}
          </span>
        )}
        {unstagedCount > 0 && (
          <span
            className="ml-0.5 font-mono text-xxs font-medium tabular-nums text-amber-400"
            title={`${unstagedCount} unstaged change${unstagedCount !== 1 ? "s" : ""}`}
          >
            ~{unstagedCount}
          </span>
        )}
        {untrackedCount > 0 && (
          <span
            className="ml-0.5 font-mono text-xxs font-medium tabular-nums text-stone-500"
            title={`${untrackedCount} untracked file${untrackedCount !== 1 ? "s" : ""}`}
          >
            ?{untrackedCount}
          </span>
        )}
      </button>

      <GitStatusModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}
