import { useEffect, useRef } from "react";
import { getPlatformServices } from "../platform";
import { useReviewStore } from "../stores";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";

interface UseMenuEventsOptions {
  handleClose: () => void;
  handleNewTab: () => void;
  handleOpenRepo: () => void;
  handleNewWindow: () => void;
  handleRefresh: () => void;
  setShowDebugModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
}

/**
 * Sets up listeners for menu events (open repo, debug, settings, refresh, zoom).
 * Uses refs to avoid stale closures.
 */
export function useMenuEvents({
  handleClose,
  handleNewTab,
  handleOpenRepo,
  handleNewWindow,
  handleRefresh,
  setShowDebugModal,
  setShowSettingsModal,
}: UseMenuEventsOptions) {
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const setCodeFontSize = useReviewStore((s) => s.setCodeFontSize);

  // Refs to avoid stale closures
  const handleCloseRef = useRef(handleClose);
  const handleNewTabRef = useRef(handleNewTab);
  const handleOpenRepoRef = useRef(handleOpenRepo);
  const handleNewWindowRef = useRef(handleNewWindow);
  const handleRefreshRef = useRef(handleRefresh);
  const codeFontSizeRef = useRef(codeFontSize);
  const setCodeFontSizeRef = useRef(setCodeFontSize);

  useEffect(() => {
    handleCloseRef.current = handleClose;
    handleNewTabRef.current = handleNewTab;
    handleOpenRepoRef.current = handleOpenRepo;
    handleNewWindowRef.current = handleNewWindow;
    handleRefreshRef.current = handleRefresh;
    codeFontSizeRef.current = codeFontSize;
    setCodeFontSizeRef.current = setCodeFontSize;
  }, [
    handleClose,
    handleNewTab,
    handleOpenRepo,
    handleNewWindow,
    handleRefresh,
    codeFontSize,
    setCodeFontSize,
  ]);

  // Listen for menu events (setup once, use refs for current values)
  useEffect(() => {
    const platform = getPlatformServices();
    const { on } = platform.menuEvents;

    // Define all menu event handlers
    const listeners: [string, (payload?: unknown) => void][] = [
      // CLI install events (from Help menu)
      [
        "cli:installed",
        () => {
          platform.dialogs.message(
            "The 'review' command has been installed to /usr/local/bin/review",
            { title: "CLI Installed", kind: "info" },
          );
        },
      ],
      [
        "cli:install-error",
        (payload) => {
          const errorMsg =
            typeof payload === "string"
              ? payload
              : "Failed to install the CLI. Try running:\n  sudo ln -sf /Applications/Review.app/Contents/MacOS/review-cli /usr/local/bin/review";
          platform.dialogs.message(errorMsg, {
            title: "CLI Install Failed",
            kind: "error",
          });
        },
      ],
      // Menu actions
      ["menu:close", () => handleCloseRef.current()],
      ["menu:new-tab", () => handleNewTabRef.current()],
      ["menu:open-repo", () => handleOpenRepoRef.current()],
      ["menu:new-window", () => handleNewWindowRef.current()],
      ["menu:show-debug", () => setShowDebugModal(true)],
      ["menu:open-settings", () => setShowSettingsModal(true)],
      ["menu:refresh", () => handleRefreshRef.current()],
      // Zoom controls
      [
        "menu:zoom-in",
        () => {
          setCodeFontSizeRef.current(
            Math.min(
              codeFontSizeRef.current + CODE_FONT_SIZE_STEP,
              CODE_FONT_SIZE_MAX,
            ),
          );
        },
      ],
      [
        "menu:zoom-out",
        () => {
          setCodeFontSizeRef.current(
            Math.max(
              codeFontSizeRef.current - CODE_FONT_SIZE_STEP,
              CODE_FONT_SIZE_MIN,
            ),
          );
        },
      ],
      [
        "menu:zoom-reset",
        () => setCodeFontSizeRef.current(CODE_FONT_SIZE_DEFAULT),
      ],
    ];

    const unlistenFns = listeners.map(([event, handler]) => on(event, handler));

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [setShowDebugModal, setShowSettingsModal]); // Modal setters are stable
}
