import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { SimpleTooltip } from "../ui/tooltip";

interface HunkNavigatorProps {
  filePath: string;
}

export function HunkNavigator({ filePath }: HunkNavigatorProps) {
  const hunks = useReviewStore((s) => s.hunks);
  const focusedHunkIndex = useReviewStore((s) => s.focusedHunkIndex);

  // Global indices of hunks belonging to this file
  const fileHunkIndices = useMemo(
    () =>
      hunks.reduce<number[]>((acc, h, i) => {
        if (h.filePath === filePath) acc.push(i);
        return acc;
      }, []),
    [hunks, filePath],
  );

  // Don't render when file has fewer than 2 hunks
  if (fileHunkIndices.length < 2) return null;

  const positionInFile = fileHunkIndices.indexOf(focusedHunkIndex);
  const isInThisFile = positionInFile >= 0;
  const isFirst = positionInFile === 0;
  const isLast = positionInFile === fileHunkIndices.length - 1;

  const goToPrev = () => {
    if (!isInThisFile || isFirst) return;
    useReviewStore.setState({
      focusedHunkIndex: fileHunkIndices[positionInFile - 1],
    });
  };

  const goToNext = () => {
    if (!isInThisFile || isLast) return;
    useReviewStore.setState({
      focusedHunkIndex: fileHunkIndices[positionInFile + 1],
    });
  };

  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-full bg-stone-800/90 backdrop-blur-sm border border-stone-700/80 px-1.5 py-1 shadow-xl shadow-black/30">
        {/* Previous hunk */}
        <SimpleTooltip content="Previous hunk">
          <button
            onClick={goToPrev}
            disabled={!isInThisFile || isFirst}
            className="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-700/50 hover:text-stone-200 disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Previous hunk"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
        </SimpleTooltip>

        {/* Position counter */}
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-stone-400 select-none">
          {isInThisFile
            ? `${positionInFile + 1} of ${fileHunkIndices.length}`
            : `\u2013 of ${fileHunkIndices.length}`}
        </span>

        {/* Next hunk */}
        <SimpleTooltip content="Next hunk">
          <button
            onClick={goToNext}
            disabled={!isInThisFile || isLast}
            className="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-700/50 hover:text-stone-200 disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Next hunk"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </SimpleTooltip>
      </div>
    </div>
  );
}
