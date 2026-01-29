import { useEffect } from "react";
import { getPlatformServices } from "../platform";
import type { Comparison } from "../types";

/**
 * Updates the window title based on repository and comparison state.
 * Always shows "repoName — base..compare".
 */
export function useWindowTitle(
  repoPath: string | null,
  comparison: Comparison,
  comparisonReady: boolean,
) {
  useEffect(() => {
    const platform = getPlatformServices();
    if (!repoPath) {
      platform.window.setTitle("Review").catch(console.error);
    } else {
      const repoName = repoPath.split("/").pop() || "Repository";
      if (comparisonReady) {
        const compareDisplay = comparison.workingTree
          ? "Working Tree"
          : comparison.new;
        const title = `${repoName} — ${comparison.old}..${compareDisplay}`;
        platform.window.setTitle(title).catch(console.error);
      } else {
        platform.window.setTitle(repoName).catch(console.error);
      }
    }
  }, [repoPath, comparisonReady, comparison]);
}
