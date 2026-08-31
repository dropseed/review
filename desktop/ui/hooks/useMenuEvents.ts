import { useEffect } from "react";
import { getPlatformServices } from "../platform";
import { findCommand } from "../commands";
import { buildCommandContext } from "../commands/useCommandDispatch";

/**
 * Native menu item → the command it runs, and the event mod.rs emits for it.
 *
 * Keyed by menu *id* with the event spelled out, because the two do not always
 * match — `actual_size` emits `menu:zoom-reset`, `settings` emits
 * `menu:open-settings`. Deriving one from the other looks obvious and silently
 * skipped those items in the drift guard.
 *
 * The menu is a second *entrance* to a command, not a second implementation of
 * it. Anything here that has a keyboard shortcut is dispatched by
 * `useCommandDispatch` too, which is why the shortcuts also work in web mode
 * where there is no native menu.
 */
export const MENU_COMMANDS: Record<string, { event: string; command: string }> =
  {
    open_repo: { event: "menu:open-repo", command: "app.openRepo" },
    settings: { event: "menu:open-settings", command: "app.settings" },
    close: { event: "menu:close", command: "app.closeTab" },
    new_terminal: { event: "menu:new-terminal", command: "terminal.new" },
    reopen_terminal: {
      event: "menu:reopen-terminal",
      command: "terminal.undoClose",
    },
    new_workspace: {
      event: "menu:new-workspace",
      command: "workspace.new",
    },
    show_debug: { event: "menu:show-debug", command: "app.debug" },
    refresh: { event: "menu:refresh", command: "review.refresh" },
    zoom_in: { event: "menu:zoom-in", command: "view.zoomIn" },
    zoom_out: { event: "menu:zoom-out", command: "view.zoomOut" },
    actual_size: { event: "menu:zoom-reset", command: "view.zoomReset" },
    find_file: { event: "menu:find-file", command: "go.file" },
    find_symbols: { event: "menu:find-symbols", command: "go.symbol" },
    search_in_files: { event: "menu:search-in-files", command: "go.search" },
    toggle_sidebar: {
      event: "menu:toggle-sidebar",
      command: "view.toggleSidebar",
    },
    toggle_files_panel: {
      event: "menu:toggle-files-panel",
      command: "view.toggleFilesPanel",
    },
    new_review: { event: "menu:new-review", command: "review.new" },
    reveal_in_browse: {
      event: "menu:reveal-in-browse",
      command: "go.revealInBrowse",
    },
    restart_lsp: { event: "menu:restart-lsp", command: "app.restartLsp" },
  };

/**
 * Route native menu events to commands, plus the two CLI-install dialogs that
 * are not commands because nothing else can trigger them.
 */
export function useMenuEvents() {
  useEffect(() => {
    const platform = getPlatformServices();
    const { on } = platform.menuEvents;

    const unlisten = Object.values(MENU_COMMANDS).map(
      ({ event, command: id }) =>
        on(event, () => {
          const command = findCommand(id);
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
            : "Failed to install the CLI. Try running:\n  sudo ln -sf /Applications/Spur.app/Contents/MacOS/spur-cli /usr/local/bin/review";
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
