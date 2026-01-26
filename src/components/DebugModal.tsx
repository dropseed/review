import { useEffect, useCallback } from "react";
import { useReviewStore } from "../stores/reviewStore";

interface DebugModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DebugModal({ isOpen, onClose }: DebugModalProps) {
  const {
    repoPath,
    comparison,
    selectedFile,
    files,
    hunks,
    reviewState,
    focusedHunkIndex,
  } = useReviewStore();

  const debugData = {
    repoPath,
    comparison,
    selectedFile,
    focusedHunkIndex,
    files,
    hunks,
    reviewState,
  };

  const jsonString = JSON.stringify(debugData, null, 2);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(jsonString).catch((err) => {
      console.error("Failed to copy:", err);
    });
  }, [jsonString]);

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[80vh] w-[80vw] max-w-4xl flex-col rounded-lg border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-700 px-4 py-3">
          <h2 className="text-sm font-medium text-stone-100">Debug Data</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
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

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-stone-300">
            {jsonString}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-stone-700 px-4 py-3">
          <button
            onClick={handleCopy}
            className="rounded bg-stone-700 px-3 py-1.5 text-xs font-medium text-stone-100 hover:bg-stone-600"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
}
