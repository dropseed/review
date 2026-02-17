import { useReviewStore } from "../stores";
import { SimpleTooltip } from "./ui/tooltip";

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
  const gitStatus = useReviewStore((s) => s.gitStatus);

  if (!gitStatus) {
    return null;
  }

  const stagedCount = gitStatus.staged.length;
  const unstagedCount = gitStatus.unstaged.length;
  const untrackedCount = gitStatus.untracked.length;
  const hasChanges = stagedCount > 0 || unstagedCount > 0 || untrackedCount > 0;

  const handleClick = () => {
    useReviewStore.setState({
      filesPanelCollapsed: false,
      requestedFilesPanelTab: "git",
    });
  };

  return (
    <SimpleTooltip
      content={`Branch: ${gitStatus.currentBranch}${hasChanges ? " (has changes)" : ""}`}
    >
      <button
        onClick={handleClick}
        className="flex items-center gap-1 rounded px-1.5 py-0.5
                   text-fg-muted hover:bg-surface-raised hover:text-fg-secondary
                   transition-colors"
      >
        <BranchIcon className="h-3 w-3 text-fg0" />
        <span className="font-medium text-fg-secondary max-w-[7rem] truncate">
          {gitStatus.currentBranch}
        </span>

        {hasChanges && (
          <span className="text-xxs text-fg0">+ working tree</span>
        )}
      </button>
    </SimpleTooltip>
  );
}
