import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSpurStore } from "../stores";
import {
  useCommandRegistryVersion,
  getAllCommands,
  resolveCommands,
} from "../commands";
import { buildCommandContext } from "../commands/useCommandDispatch";
import { MENU_COMMANDS } from "./useMenuEvents";

const MENU_ITEM_COMMANDS = Object.entries(MENU_COMMANDS).map(
  ([menuId, { command }]) => [menuId, command] as const,
);

/**
 * Keep native menu items enabled exactly when their command is.
 *
 * The rules are the commands' own `isVisible`/`isEnabled` predicates — there
 * is no second model here. That matters beyond tidiness: macOS lets a
 * *disabled* menu item's accelerator fall through to the webview, so any item
 * this greys out while its command stays runnable is a shortcut that fires
 * anyway, with the menu claiming otherwise.
 */
export function useMenuState() {
  useCommandRegistryVersion();

  // Any store write can change a predicate's answer, and predicates read
  // arbitrary state, so nothing narrower than the whole store is correct here.
  useSpurStore((s) => s);

  useEffect(() => {
    const ctx = buildCommandContext();
    const resolved = new Map(
      resolveCommands(getAllCommands(), ctx).map((r) => [
        r.command.id,
        r.enabled,
      ]),
    );

    const states: Record<string, boolean> = {};
    for (const [menuId, commandId] of MENU_ITEM_COMMANDS) {
      // Absent from the resolved set means `isVisible` said no, which for a
      // menu reads as unavailable rather than hidden.
      states[menuId] = resolved.get(commandId) ?? false;
    }

    invoke("set_menu_enabled", { states }).catch(() => {
      // Silently ignore — not available in web/debug mode
    });
  });
}
