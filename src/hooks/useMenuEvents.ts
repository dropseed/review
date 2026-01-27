import { useEffect, useRef } from "react";
import { getPlatformServices } from "../platform";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";

interface UseMenuEventsOptions {
  handleOpenRepo: () => void;
  handleNewWindow: () => void;
  handleRefresh: () => void;
  codeFontSize: number;
  setCodeFontSize: (size: number) => void;
  setShowDebugModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
}

/**
 * Sets up listeners for menu events (open repo, debug, settings, refresh, zoom).
 * Uses refs to avoid stale closures.
 */
export function useMenuEvents({
  handleOpenRepo,
  handleNewWindow,
  handleRefresh,
  codeFontSize,
  setCodeFontSize,
  setShowDebugModal,
  setShowSettingsModal,
}: UseMenuEventsOptions) {
  // Refs to avoid stale closures
  const handleOpenRepoRef = useRef(handleOpenRepo);
  const handleNewWindowRef = useRef(handleNewWindow);
  const handleRefreshRef = useRef(handleRefresh);
  const codeFontSizeRef = useRef(codeFontSize);
  const setCodeFontSizeRef = useRef(setCodeFontSize);

  useEffect(() => {
    handleOpenRepoRef.current = handleOpenRepo;
    handleNewWindowRef.current = handleNewWindow;
    handleRefreshRef.current = handleRefresh;
    codeFontSizeRef.current = codeFontSize;
    setCodeFontSizeRef.current = setCodeFontSize;
  }, [
    handleOpenRepo,
    handleNewWindow,
    handleRefresh,
    codeFontSize,
    setCodeFontSize,
  ]);

  // Listen for menu events (setup once, use refs for current values)
  useEffect(() => {
    const platform = getPlatformServices();
    const unlistenFns: (() => void)[] = [];

    unlistenFns.push(
      platform.menuEvents.on("menu:open-repo", () => {
        handleOpenRepoRef.current();
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:new-window", () => {
        handleNewWindowRef.current();
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:show-debug", () => {
        setShowDebugModal(true);
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:open-settings", () => {
        setShowSettingsModal(true);
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:refresh", () => {
        handleRefreshRef.current();
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:zoom-in", () => {
        setCodeFontSizeRef.current(
          Math.min(
            codeFontSizeRef.current + CODE_FONT_SIZE_STEP,
            CODE_FONT_SIZE_MAX,
          ),
        );
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:zoom-out", () => {
        setCodeFontSizeRef.current(
          Math.max(
            codeFontSizeRef.current - CODE_FONT_SIZE_STEP,
            CODE_FONT_SIZE_MIN,
          ),
        );
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:zoom-reset", () => {
        setCodeFontSizeRef.current(CODE_FONT_SIZE_DEFAULT);
      }),
    );

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [setShowDebugModal, setShowSettingsModal]); // Modal setters are stable
}
