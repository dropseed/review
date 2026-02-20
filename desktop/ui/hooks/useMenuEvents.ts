import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  handleNewWindow: () => void;
  handleRefresh: () => void;
  setShowDebugModal: (show: boolean) => void;
  setShowFileFinder: (show: boolean) => void;
  setShowContentSearch: (show: boolean) => void;
  setShowSymbolSearch: (show: boolean) => void;
}

/**
 * Sets up listeners for menu events (open repo, debug, settings, refresh, zoom).
 * Uses refs to avoid stale closures.
 */
export function useMenuEvents({
  handleClose,
  handleNewTab,
  handleNewWindow,
  handleRefresh,
  setShowDebugModal,
  setShowFileFinder,
  setShowContentSearch,
  setShowSymbolSearch,
}: UseMenuEventsOptions) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const setCodeFontSize = useReviewStore((s) => s.setCodeFontSize);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  // Refs to avoid stale closures
  const handleCloseRef = useRef(handleClose);
  const handleNewTabRef = useRef(handleNewTab);
  const handleNewWindowRef = useRef(handleNewWindow);
  const handleRefreshRef = useRef(handleRefresh);
  const codeFontSizeRef = useRef(codeFontSize);
  const setCodeFontSizeRef = useRef(setCodeFontSize);

  useEffect(() => {
    handleCloseRef.current = handleClose;
    handleNewTabRef.current = handleNewTab;
    handleNewWindowRef.current = handleNewWindow;
    handleRefreshRef.current = handleRefresh;
    codeFontSizeRef.current = codeFontSize;
    setCodeFontSizeRef.current = setCodeFontSize;
    navigateRef.current = navigate;
  }, [
    handleClose,
    handleNewTab,
    handleNewWindow,
    handleRefresh,
    codeFontSize,
    setCodeFontSize,
    navigate,
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
      // Note: menu:open-repo is handled globally in AppShell (router.tsx)
      ["menu:close", () => handleCloseRef.current()],
      ["menu:new-tab", () => handleNewTabRef.current()],
      ["menu:new-window", () => handleNewWindowRef.current()],
      ["menu:show-debug", () => setShowDebugModal(true)],
      // Note: menu:open-settings is handled globally in TabRail (always mounted)
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
      // View menu actions
      ["menu:find-file", () => setShowFileFinder(true)],
      ["menu:find-symbols", () => setShowSymbolSearch(true)],
      ["menu:search-in-files", () => setShowContentSearch(true)],
      ["menu:toggle-sidebar", () => toggleTabRail()],
      // Companion server stopped from tray menu — sync UI state
      // (server already stopped by Rust, so just update the store)
      [
        "companion-server:stopped",
        () => {
          useReviewStore.setState({ companionServerEnabled: false });
          platform.storage.set("companionServerEnabled", false);
        },
      ],
      [
        "menu:new-review",
        () => {
          navigateRef.current("/new");
        },
      ],
    ];

    const unlistenFns = listeners.map(([event, handler]) => on(event, handler));

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [
    setShowDebugModal,
    setShowFileFinder,
    setShowContentSearch,
    setShowSymbolSearch,
    toggleTabRail,
  ]);
}
