import { useEffect } from "react";
import { getPlatformServices } from "../platform";
import type { Comparison } from "../types";

/**
 * Updates the window title based on repository and comparison state.
 */
export function useWindowTitle(
  repoPath: string | null,
  comparison: Comparison,
  comparisonReady: boolean,
  showStartScreen: boolean,
) {
  useEffect(() => {
    if (repoPath) {
      const platform = getPlatformServices();
      const repoName = repoPath.split("/").pop() || "Repository";
      if (showStartScreen || !comparisonReady) {
        // Just show repo name on start screen
        platform.window.setTitle(repoName).catch(console.error);
      } else {
        const compareDisplay = comparison.workingTree
          ? "Working Tree"
          : comparison.new;
        const title = `${repoName} — ${comparison.old}..${compareDisplay}`;
        platform.window.setTitle(title).catch(console.error);
      }
    }
  }, [repoPath, comparisonReady, comparison, showStartScreen]);
}
