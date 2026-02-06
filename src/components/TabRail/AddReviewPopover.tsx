import { useCallback, memo } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { useReviewStore } from "../../stores";
import type { RecentRepo } from "../../utils/preferences";

interface AddReviewPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenRepo: () => void;
  onSelectRepo: (path: string) => void;
}

export const AddReviewPopover = memo(function AddReviewPopover({
  isOpen,
  onOpenChange,
  onOpenRepo,
  onSelectRepo,
}: AddReviewPopoverProps) {
  const recentRepositories = useReviewStore((s) => s.recentRepositories);

  const handleOpenRepo = useCallback(() => {
    onOpenChange(false);
    onOpenRepo();
  }, [onOpenChange, onOpenRepo]);

  const handleSelectRecent = useCallback(
    (repo: RecentRepo) => {
      onOpenChange(false);
      onSelectRepo(repo.path);
    },
    [onOpenChange, onSelectRepo],
  );

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center w-full py-2 rounded-lg
                     text-stone-500 hover:text-stone-300 hover:bg-stone-800/50
                     transition-colors duration-100"
          aria-label="Add review"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        side="right"
        align="end"
        sideOffset={8}
      >
        {/* Open Repository button */}
        <button
          onClick={handleOpenRepo}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-stone-300
                     hover:bg-stone-800/50 transition-colors border-b border-stone-800/50"
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

        {/* Recent repositories */}
        {recentRepositories.length > 0 && (
          <div className="py-1">
            <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-stone-500">
              Recent
            </div>
            {recentRepositories.map((repo) => (
              <button
                key={repo.path}
                onClick={() => handleSelectRecent(repo)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-stone-400
                           hover:bg-stone-800/50 hover:text-stone-200 transition-colors"
              >
                <svg
                  className="h-3 w-3 text-stone-600 shrink-0"
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
      </PopoverContent>
    </Popover>
  );
});
