import { useEffect, useState, useCallback } from "react";
import { useReviewStore } from "../../../stores/reviewStore";
import { getPlatformServices } from "../../../platform";
import type { ContextMenuState } from "../types";

interface UseFilePanelContextMenuOptions {
  repoPath: string | null;
}

/**
 * Handles context menu state and actions.
 * Groups: repoPath, openInSplit, platformName
 */
export function useFilePanelContextMenu({
  repoPath,
}: UseFilePanelContextMenuOptions) {
  const { openInSplit } = useReviewStore();

  const [platformName, setPlatformName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Detect platform
  useEffect(() => {
    setPlatformName(getPlatformServices().window.getPlatformName());
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.preventDefault();
      const fullPath = `${repoPath}/${path}`;
      const revealLabel =
        platformName === "macos"
          ? "Reveal in Finder"
          : platformName === "windows"
            ? "Reveal in Explorer"
            : "Reveal in Files";
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        path,
        fullPath,
        revealLabel,
      });
    },
    [repoPath, platformName],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    platformName,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
    openInSplit,
  };
}
