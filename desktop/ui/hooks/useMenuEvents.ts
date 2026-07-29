import { useEffect } from "react";
import { getPlatformServices } from "../platform";
import { findCommand } from "../commands";
import { buildCommandContext } from "../commands/useCommandDispatch";

/**
 * Native menu item id → command id.
 *
 * The menu is a second *entrance* to a command, not a second implementation of
 * it. Anything here that has a keyboard shortcut is dispatched by
 * `useCommandDispatch` too, which is why the shortcuts also work in web mode
 * where there is no native menu.
 */
export const MENU_COMMANDS: Record<string, string> = {
  "menu:close": "app.closeTab",
  "menu:new-tab": "app.newTab",
  "menu:new-window": "app.newWindow",
  "menu:show-debug": "app.debug",
  "menu:refresh": "review.refresh",
  "menu:zoom-in": "view.zoomIn",
  "menu:zoom-out": "view.zoomOut",
  "menu:zoom-reset": "view.zoomReset",
  "menu:find-file": "go.file",
  "menu:find-symbols": "go.symbol",
  "menu:search-in-files": "go.search",
  "menu:toggle-sidebar": "view.toggleSidebar",
  "menu:new-review": "review.new",
  "menu:reveal-in-browse": "go.revealInBrowse",
  "menu:restart-lsp": "app.restartLsp",
};

/**
 * Route native menu events to commands, plus the two CLI-install dialogs that
 * are not commands because nothing else can trigger them.
 */
export function useMenuEvents() {
  useEffect(() => {
    const platform = getPlatformServices();
    const { on } = platform.menuEvents;

    const unlisten = Object.entries(MENU_COMMANDS).map(([event, commandId]) =>
      on(event, () => {
        const command = findCommand(commandId);
        if (!command) return;
        const ctx = buildCommandContext();
        // The menu item may be stale by a frame; re-check before running.
        if (command.isEnabled && !command.isEnabled(ctx)) return;
        void command.run(ctx);
      }),
    );

    unlisten.push(
      on("cli:installed", () => {
        platform.dialogs.message(
          "The 'review' command has been installed to /usr/local/bin/review",
          { title: "CLI Installed", kind: "info" },
        );
      }),
      on("cli:install-error", (payload) => {
        const errorMsg =
          typeof payload === "string"
            ? payload
            : "Failed to install the CLI. Try running:\n  sudo ln -sf /Applications/Review.app/Contents/MacOS/review-cli /usr/local/bin/review";
        platform.dialogs.message(errorMsg, {
          title: "CLI Install Failed",
          kind: "error",
        });
      }),
    );

    return () => {
      unlisten.forEach((fn) => fn());
    };
  }, []);
}
