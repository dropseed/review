import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { invoke } from "@tauri-apps/api/core";

/**
 * Keeps native menu item enabled/disabled state in sync with the app view.
 * Calls `update_menu_state` whenever `repoPath` or `topLevelView` changes.
 */
export function useMenuState() {
  const repoPath = useReviewStore((s) => s.repoPath);
  const topLevelView = useReviewStore((s) => s.topLevelView);

  useEffect(() => {
    invoke("update_menu_state", {
      hasRepo: !!repoPath,
      view: repoPath ? (topLevelView ?? "none") : "none",
    }).catch(() => {
      // Silently ignore — not available in web/debug mode
    });
  }, [repoPath, topLevelView]);
}
