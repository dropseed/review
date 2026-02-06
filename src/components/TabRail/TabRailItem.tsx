import { useCallback, useState, useRef, useEffect, memo } from "react";
import type { Comparison } from "../../types";
import type { OpenReview } from "../../stores/slices/tabRailSlice";

/** Format a comparison for display in the tab rail. */
function formatComparison(comparison: Comparison): string {
  if (comparison.workingTree) {
    return `${comparison.old}..Working Tree`;
  }
  if (comparison.stagedOnly) {
    return `${comparison.old}..Staged`;
  }
  if (comparison.githubPr) {
    return `PR #${comparison.githubPr.number}`;
  }
  return `${comparison.old}..${comparison.new}`;
}

interface TabRailItemProps {
  review: OpenReview;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onSwitchComparison: () => void;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  isActive,
  onActivate,
  onClose,
  onSwitchComparison,
}: TabRailItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const comparisonDisplay = formatComparison(review.comparison);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showContextMenu]);

  return (
    <>
      <button
        onClick={onActivate}
        onContextMenu={handleContextMenu}
        className={`group relative w-full text-left px-2.5 py-2 rounded-lg mb-0.5
                    transition-all duration-100
                    ${
                      isActive
                        ? "bg-stone-800/90 shadow-sm shadow-black/20 ring-1 ring-stone-700/50"
                        : "hover:bg-stone-800/40"
                    }`}
        aria-current={isActive ? "true" : undefined}
        title={`${review.repoName} - ${comparisonDisplay}`}
      >
        {/* Active indicator dot */}
        {isActive && (
          <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-amber-500" />
        )}
        {/* Repo name */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <span
            className={`text-xs font-semibold truncate ${
              isActive ? "text-stone-200" : "text-stone-400"
            }`}
          >
            {review.repoName}
          </span>
          {/* Close button — appears on hover */}
          <span
            role="button"
            tabIndex={-1}
            onClick={handleCloseClick}
            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100
                       text-stone-600 hover:text-stone-300 hover:bg-stone-700/50
                       transition-opacity duration-75"
            aria-label={`Close ${review.repoName}`}
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
        </div>
        {/* Comparison key */}
        <span
          className={`text-2xs truncate block mt-0.5 ${
            isActive ? "text-stone-500" : "text-stone-600"
          }`}
        >
          {comparisonDisplay}
        </span>
      </button>

      {/* Context menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-lg border border-stone-700 bg-stone-800 py-1 shadow-xl"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            onClick={() => {
              setShowContextMenu(false);
              onSwitchComparison();
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 transition-colors"
          >
            Switch Comparison...
          </button>
          <button
            onClick={() => {
              setShowContextMenu(false);
              onClose();
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 transition-colors"
          >
            Close Tab
          </button>
        </div>
      )}
    </>
  );
});
