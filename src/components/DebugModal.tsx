import { useCallback, useMemo, useState } from "react";
import { useReviewStore } from "../stores/reviewStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

// Simple JSON syntax highlighting
function highlightJson(json: string): React.ReactNode[] {
  const lines = json.split("\n");
  return lines.map((line, i) => {
    // Highlight different parts of JSON
    const highlighted = line
      // Keys (before colon)
      .replace(/"([^"]+)":/g, '<span class="text-sky-400">"$1"</span>:')
      // String values
      .replace(/: "([^"]*)"/g, ': <span class="text-amber-300">"$1"</span>')
      // Numbers
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="text-violet-400">$1</span>')
      // Booleans and null
      .replace(
        /: (true|false|null)/g,
        ': <span class="text-rose-400">$1</span>',
      );
    return <div key={i} dangerouslySetInnerHTML={{ __html: highlighted }} />;
  });
}

interface DebugModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DebugModal({ isOpen, onClose }: DebugModalProps) {
  const [activeTab, setActiveTab] = useState<"persisted" | "in-memory">(
    "persisted",
  );

  const {
    repoPath,
    comparison,
    selectedFile,
    files,
    hunks,
    reviewState,
    focusedHunkIndex,
  } = useReviewStore();

  const persistedData = { reviewState };
  const inMemoryData = {
    repoPath,
    comparison,
    selectedFile,
    focusedHunkIndex,
    files,
    hunks,
  };

  const persistedJsonString = JSON.stringify(persistedData, null, 2);
  const inMemoryJsonString = JSON.stringify(inMemoryData, null, 2);
  const fullJsonString = JSON.stringify(
    { ...persistedData, ...inMemoryData },
    null,
    2,
  );

  const highlightedPersistedJson = useMemo(
    () => highlightJson(persistedJsonString),
    [persistedJsonString],
  );
  const highlightedInMemoryJson = useMemo(
    () => highlightJson(inMemoryJsonString),
    [inMemoryJsonString],
  );

  // Construct the review state file path
  const reviewStatePath = useMemo(() => {
    if (!repoPath || !comparison) return null;
    const comparisonKey = comparison.key || "unknown";
    return `${repoPath}/.git/review/reviews/${comparisonKey}.json`;
  }, [repoPath, comparison]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullJsonString).catch((err) => {
      console.error("Failed to copy:", err);
    });
  }, [fullJsonString]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-[80vw] max-w-4xl flex-col rounded-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">Debug Data</DialogTitle>
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
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-stone-700">
          <button
            onClick={() => setActiveTab("persisted")}
            className={`px-4 py-2 text-xs font-medium ${
              activeTab === "persisted"
                ? "border-b-2 border-sky-500 text-sky-400"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            Persisted State
          </button>
          <button
            onClick={() => setActiveTab("in-memory")}
            className={`px-4 py-2 text-xs font-medium ${
              activeTab === "in-memory"
                ? "border-b-2 border-sky-500 text-sky-400"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            In-Memory State
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === "persisted" && (
            <div>
              {reviewStatePath && (
                <div className="mb-3 rounded bg-stone-800 px-3 py-2">
                  <span className="text-xs text-stone-500">Saved to: </span>
                  <span className="font-mono text-xs text-stone-300">
                    {reviewStatePath}
                  </span>
                </div>
              )}
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-stone-300">
                {highlightedPersistedJson}
              </pre>
            </div>
          )}
          {activeTab === "in-memory" && (
            <div>
              <div className="mb-3 rounded bg-stone-800 px-3 py-2">
                <span className="text-xs text-stone-500">
                  Computed from git, not persisted to disk
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-stone-300">
                {highlightedInMemoryJson}
              </pre>
            </div>
          )}
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
      </DialogContent>
    </Dialog>
  );
}
