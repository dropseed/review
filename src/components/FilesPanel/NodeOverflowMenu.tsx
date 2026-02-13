import { useState } from "react";
import { getPlatformServices } from "../../platform";
import { useReviewStore } from "../../stores";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";

interface NodeOverflowMenuProps {
  path: string;
  isDirectory: boolean;
  hasPending: boolean;
  hasApproved: boolean;
  hasRejected: boolean;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onUnapproveAll: () => void;
  onOpenInSplit?: (path: string) => void;
  revealLabel?: string;
}

export function NodeOverflowMenu({
  path,
  isDirectory,
  hasPending,
  hasApproved,
  hasRejected,
  onApproveAll,
  onRejectAll,
  onUnapproveAll,
  onOpenInSplit,
  revealLabel = "Reveal in Finder",
}: NodeOverflowMenuProps) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const [open, setOpen] = useState(false);
  const fullPath = repoPath ? `${repoPath}/${path}` : path;

  const showReviewActions = hasPending || hasApproved || hasRejected;
  const showFileActions = !isDirectory;

  if (!showReviewActions && !showFileActions) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center justify-center w-5 h-5 rounded
                     text-stone-500 hover:text-stone-300 hover:bg-stone-700/50
                     transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Review actions */}
        {hasPending && (
          <>
            <DropdownMenuItem onClick={onApproveAll}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Approve all hunks
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRejectAll}>
              <svg
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
              Reject all hunks
            </DropdownMenuItem>
          </>
        )}
        {(hasApproved || hasRejected) && (
          <DropdownMenuItem onClick={onUnapproveAll}>
            <svg
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
              />
            </svg>
            Reset review
          </DropdownMenuItem>
        )}

        {/* File actions */}
        {showFileActions && showReviewActions && <DropdownMenuSeparator />}
        {showFileActions && (
          <>
            {onOpenInSplit && (
              <>
                <DropdownMenuItem onClick={() => onOpenInSplit(path)}>
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 4v16M15 4v16"
                    />
                  </svg>
                  Open in Split View
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={async () => {
                const platform = getPlatformServices();
                await platform.opener.openUrl(`vscode://file${fullPath}`);
              }}
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              Open in VS Code
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                const platform = getPlatformServices();
                await platform.clipboard.writeText(fullPath);
              }}
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy Path
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const platform = getPlatformServices();
                await platform.opener.revealItemInDir(fullPath);
              }}
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              {revealLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
