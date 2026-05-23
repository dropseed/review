import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { invoke } from "@tauri-apps/api/core";

/**
 * Keeps native menu item enabled/disabled state in sync with the app view.
 * Treats both guided review and the working-tree rolling-diff overlay as
 * non-browse views so menu items behave consistently across overlays.
 */
export function useMenuState() {
  const repoPath = useReviewStore((s) => s.repoPath);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const workingTreeMultiView = useReviewStore((s) => s.workingTreeMultiView);
  const overlayActive =
    guideContentMode !== null || workingTreeMultiView !== null;

  useEffect(() => {
    invoke("update_menu_state", {
      hasRepo: !!repoPath,
      view: repoPath ? (overlayActive ? "guide" : "browse") : "none",
    }).catch(() => {
      // Silently ignore — not available in web/debug mode
    });
  }, [repoPath, overlayActive]);
}
