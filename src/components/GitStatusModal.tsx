import { useState, useEffect } from "react";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { SimpleTooltip } from "./ui/tooltip";

interface GitStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GitStatusModal({ isOpen, onClose }: GitStatusModalProps) {
  const { gitStatus, repoPath } = useReviewStore();
  const [rawStatus, setRawStatus] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Load raw status when modal opens
  useEffect(() => {
    if (isOpen && repoPath) {
      getApiClient()
        .getGitStatusRaw(repoPath)
        .then(setRawStatus)
        .catch((err) => {
          console.error("Failed to get raw git status:", err);
          setRawStatus("Failed to load git status");
        });
    }
  }, [isOpen, repoPath]);

  // Handle copy
  const handleCopy = async () => {
    try {
      const platform = getPlatformServices();
      await platform.clipboard.writeText(rawStatus);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!gitStatus) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg overflow-hidden">
        <DialogHeader className="border-t-2 border-t-sky-500/40">
          <div className="flex items-center gap-3">
            {/* Branch icon */}
            <svg
              className="h-4 w-4 text-sky-400"
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
            <DialogTitle className="text-sm font-semibold tracking-wide">
              {gitStatus.currentBranch}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2">
            {/* Copy button */}
            <SimpleTooltip content="Copy to clipboard">
              <button
                onClick={handleCopy}
                className="rounded px-2 py-1 text-xxs font-medium text-stone-400 hover:bg-stone-700 hover:text-stone-200 transition-colors"
              >
                {copied ? (
                  <span className="flex items-center gap-1 text-lime-400">
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </span>
                )}
              </button>
            </SimpleTooltip>
            {/* Close button */}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sky-500/50"
              aria-label="Close git status"
            >
              <svg
                className="h-5 w-5"
                aria-hidden="true"
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
        </DialogHeader>

        {/* Raw output */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <pre className="p-4 font-mono text-2xs leading-relaxed text-stone-300 whitespace-pre-wrap">
            {rawStatus || "Loading..."}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
