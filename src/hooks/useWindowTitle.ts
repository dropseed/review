import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getPlatformServices } from "../platform";
import type { Comparison } from "../types";

/**
 * Updates the window title based on repository and comparison state.
 * Shows "repoName — base..compare" on review routes, just "repoName" on start screen.
 */
export function useWindowTitle(
  repoPath: string | null,
  comparison: Comparison,
  comparisonReady: boolean,
) {
  const location = useLocation();
  const isReviewRoute = location.pathname.includes("/review/");

  useEffect(() => {
    const platform = getPlatformServices();
    if (!repoPath) {
      platform.window.setTitle("Review").catch(console.error);
    } else {
      const repoName = repoPath.split("/").pop() || "Repository";
      if (isReviewRoute && comparisonReady) {
        const compareDisplay = comparison.workingTree
          ? "Working Tree"
          : comparison.new;
        const title = `${repoName} — ${comparison.old}..${compareDisplay}`;
        platform.window.setTitle(title).catch(console.error);
      } else {
        platform.window.setTitle(repoName).catch(console.error);
      }
    }
  }, [repoPath, comparisonReady, comparison, isReviewRoute]);
}
