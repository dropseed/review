import { type ReactNode, useEffect, useRef, useState } from "react";
import { Spinner } from "./spinner";

interface FileDiffStackItemProps {
  filePath: string;
  isLoading: boolean;
  /** Right-side header content (action buttons, status indicator). */
  headerActions?: ReactNode;
  /** When this prop transitions false → true, the item auto-collapses. */
  autoCollapseSignal?: boolean;
  /** Opens the file in the single-file viewer. */
  onViewFile: () => void;
  children: ReactNode;
}

/**
 * One file's section in a vertically stacked multi-file diff view. Provides
 * a sticky path header with a collapse caret, a "view full file" link, an
 * optional spinner while loading, and an optional auto-collapse-on-complete
 * signal for guided review flows.
 */
export function FileDiffStackItem({
  filePath,
  isLoading,
  headerActions,
  autoCollapseSignal,
  onViewFile,
  children,
}: FileDiffStackItemProps): ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const prevAutoCollapse = useRef(false);
  useEffect(() => {
    if (autoCollapseSignal && !prevAutoCollapse.current) {
      setIsCollapsed(true);
    }
    prevAutoCollapse.current = autoCollapseSignal ?? false;
  }, [autoCollapseSignal]);

  return (
    <div className="border-b border-edge/50">
      <div className="sticky top-[72px] z-[9] bg-surface-panel/95 backdrop-blur-sm flex items-center gap-2 px-4 py-1.5 border-b border-edge/30">
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="shrink-0 text-fg-muted hover:text-fg-secondary transition-colors"
          aria-label={isCollapsed ? "Expand file" : "Collapse file"}
        >
          <svg
            className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="font-mono text-xs text-fg-muted flex-1 truncate text-left hover:text-fg-secondary transition-colors"
        >
          {filePath}
        </button>
        <button
          type="button"
          onClick={onViewFile}
          className="shrink-0 text-fg-muted hover:text-fg-secondary transition-colors p-0.5 rounded hover:bg-surface-hover"
          title="View full file"
          aria-label="View full file"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
          </svg>
        </button>
        {headerActions}
      </div>

      {!isCollapsed && (
        <>
          {isLoading && (
            <div className="flex items-center gap-2 px-4 py-6 text-fg-muted">
              <Spinner className="h-4 w-4" />
              <span className="text-xs">Loading diff...</span>
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}
