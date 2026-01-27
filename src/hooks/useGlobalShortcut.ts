import { useEffect } from "react";
import { getPlatformServices } from "../platform";

/**
 * Registers a global keyboard shortcut (Cmd/Ctrl+Shift+R) to focus the app.
 */
export function useGlobalShortcut() {
  useEffect(() => {
    const shortcut = "CommandOrControl+Shift+R";
    const platform = getPlatformServices();

    const registerShortcut = async () => {
      try {
        await platform.shortcuts.register(shortcut, async () => {
          await platform.window.show();
          await platform.window.focus();
        });
      } catch (err) {
        // Shortcut may already be registered or in use
        console.debug("Global shortcut registration skipped:", err);
      }
    };

    registerShortcut();

    return () => {
      platform.shortcuts.unregister(shortcut).catch(() => {});
    };
  }, []);
}
