import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useSpurStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { useAllHunks } from "../../stores/selectors/hunks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

import { XIcon } from "../ui/icons";
function highlightJson(json: string): React.ReactNode[] {
  const lines = json.split("\n");
  return lines.map((line, i) => {
    const highlighted = line
      // Keys (before colon)
      .replace(/"([^"]+)":/g, '<span class="text-status-renamed">"$1"</span>:')
      // String values
      .replace(
        /: "([^"]*)"/g,
        ': <span class="text-status-modified">"$1"</span>',
      )
      // Numbers
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="text-guide">$1</span>')
      // Booleans and null
      .replace(
        /: (true|false|null)/g,
        ': <span class="text-status-rejected">$1</span>',
      );
    return <div key={i} dangerouslySetInnerHTML={{ __html: highlighted }} />;
  });
}

interface DebugModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DebugModal({ isOpen, onClose }: DebugModalProps): ReactNode {
  const [activeTab, setActiveTab] = useState<"persisted" | "in-memory">(
    "persisted",
  );

  const repoPath = useSpurStore((s) => s.repoPath);
  const comparison = useSpurStore((s) => s.comparison);
  const reviewRef = useSpurStore((s) => s.reviewRef);
  const selectedFile = useSpurStore((s) => s.selectedFile);
  const files = useSpurStore((s) => s.files);
  const hunks = useAllHunks();
  const reviewState = useSpurStore((s) => s.reviewState);
  const focusedHunkId = useSpurStore((s) => s.focusedHunkId);

  const persistedJsonString = useMemo(
    () => (isOpen ? JSON.stringify({ reviewState }, null, 2) : ""),
    [isOpen, reviewState],
  );
  const inMemoryJsonString = useMemo(
    () =>
      isOpen
        ? JSON.stringify(
            {
              repoPath,
              comparison,
              selectedFile,
              focusedHunkId,
              files,
              hunks,
            },
            null,
            2,
          )
        : "",
    [isOpen, repoPath, comparison, selectedFile, focusedHunkId, files, hunks],
  );

  const highlightedPersistedJson = useMemo(
    () => (isOpen ? highlightJson(persistedJsonString) : []),
    [isOpen, persistedJsonString],
  );
  const highlightedInMemoryJson = useMemo(
    () => (isOpen ? highlightJson(inMemoryJsonString) : []),
    [isOpen, inMemoryJsonString],
  );

  // Construct the review state file path (centralized in ~/.spur/). The file
  // is named by the review's ref (sanitized on the backend).
  const reviewStatePath = useMemo(() => {
    if (!repoPath || !reviewRef) return null;
    return `~/.spur/repos/<repo-id>/reviews/${reviewRef}.json`;
  }, [repoPath, reviewRef]);

  const handleCopy = useCallback(() => {
    const combined = {
      ...JSON.parse(persistedJsonString || "{}"),
      ...JSON.parse(inMemoryJsonString || "{}"),
    };
    // Through the platform service: `navigator.clipboard` is `undefined` in the
    // desktop app, whose `tauri://localhost` origin WKWebView doesn't treat as
    // a secure context. See `ErrorBoundary.handleCopy`.
    getPlatformServices()
      .clipboard.writeText(JSON.stringify(combined, null, 2))
      .catch((err: unknown) => {
        console.error("Failed to copy:", err);
      });
  }, [persistedJsonString, inMemoryJsonString]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-[80vw] max-w-4xl flex-col rounded-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">Debug Data</DialogTitle>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:bg-surface-raised hover:text-fg"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-edge-default">
          <button
            onClick={() => setActiveTab("persisted")}
            className={`px-4 py-2 text-xs font-medium ${
              activeTab === "persisted"
                ? "border-b-2 border-status-renamed text-status-renamed"
                : "text-fg-muted hover:text-fg-secondary"
            }`}
          >
            Persisted State
          </button>
          <button
            onClick={() => setActiveTab("in-memory")}
            className={`px-4 py-2 text-xs font-medium ${
              activeTab === "in-memory"
                ? "border-b-2 border-status-renamed text-status-renamed"
                : "text-fg-muted hover:text-fg-secondary"
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
                <div className="mb-3 rounded bg-surface-raised px-3 py-2">
                  <span className="text-xs text-fg-muted">Saved to: </span>
                  <span className="font-mono text-xs text-fg-secondary">
                    {reviewStatePath}
                  </span>
                </div>
              )}
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-fg-secondary">
                {highlightedPersistedJson}
              </pre>
            </div>
          )}
          {activeTab === "in-memory" && (
            <div>
              <div className="mb-3 rounded bg-surface-raised px-3 py-2">
                <span className="text-xs text-fg-muted">
                  Computed from git, not persisted to disk
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-fg-secondary">
                {highlightedInMemoryJson}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-edge-default px-4 py-3">
          <button
            onClick={handleCopy}
            className="rounded bg-surface-hover px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-active"
          >
            Copy to Clipboard
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
