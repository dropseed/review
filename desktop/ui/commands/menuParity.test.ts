import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_COMMANDS } from "./appCommands";
import { toAccelerator } from "./shortcuts";
import { MENU_COMMANDS } from "../hooks/useMenuEvents";

/**
 * The native macOS/Windows menu is built in Rust at startup, so it cannot
 * import the command registry. This test is the seam that keeps the two from
 * drifting: previously the accelerator, the label, and the availability rule
 * for a single action lived in six places across two languages, coordinated
 * only by a prose comment.
 */
const MOD_RS = resolve(process.cwd(), "tauri/src/desktop/mod.rs");

interface MenuItem {
  id: string;
  accelerator?: string;
}

/** Pull `.id("x")` / `.accelerator("y")` pairs out of the menu builder. */
function parseMenuItems(source: string): MenuItem[] {
  const items: MenuItem[] = [];
  const builder =
    /MenuItemBuilder::new\((?:[^)]*)\)([\s\S]*?)\.build\(app\)\?/g;

  let match: RegExpExecArray | null;
  while ((match = builder.exec(source)) !== null) {
    const body = match[1];
    const id = /\.id\("([^"]+)"\)/.exec(body)?.[1];
    if (!id) continue;
    // Rust escapes a backslash accelerator; unescape so it compares to the
    // literal the TypeScript side produces.
    const accelerator = /\.accelerator\("((?:[^"\\]|\\.)*)"\)/
      .exec(body)?.[1]
      ?.replace(/\\\\/g, "\\");
    items.push({ id, accelerator });
  }
  return items;
}

const source = readFileSync(MOD_RS, "utf8");
const menuItems = parseMenuItems(source);
const commandsById = new Map(APP_COMMANDS.map((c) => [c.id, c]));

describe("native menu parity", () => {
  it("finds the menu items in mod.rs", () => {
    // Guards the parser itself — a refactor of the Rust builder that this
    // regex stops understanding must fail loudly, not silently pass.
    expect(menuItems.length).toBeGreaterThan(10);
    expect(menuItems.some((i) => i.id === "find_file")).toBe(true);
  });

  it("maps every menu event to a command that exists", () => {
    for (const [event, commandId] of Object.entries(MENU_COMMANDS)) {
      expect(
        commandsById.has(commandId),
        `${event} maps to unknown command "${commandId}"`,
      ).toBe(true);
    }
  });

  it("gives every mapped menu item the same accelerator as its command", () => {
    // Menu ids are the event name minus the "menu:" prefix, with underscores.
    const eventForMenuId = (menuId: string) =>
      `menu:${menuId.replace(/_/g, "-")}`;

    const mismatches: string[] = [];
    for (const item of menuItems) {
      const commandId = MENU_COMMANDS[eventForMenuId(item.id)];
      if (!commandId) continue;
      const command = commandsById.get(commandId);
      if (!command) continue;

      const expected = command.shortcut
        ? toAccelerator(command.shortcut)
        : undefined;
      if (item.accelerator !== expected) {
        mismatches.push(
          `${item.id}: menu has ${item.accelerator ?? "none"}, ` +
            `command "${commandId}" has ${expected ?? "none"}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("does not bind one shortcut to two commands in the same context", () => {
    const seen = new Map<string, string>();
    const conflicts: string[] = [];

    for (const command of APP_COMMANDS) {
      if (!command.shortcut) continue;
      const key = toAccelerator(command.shortcut);
      const existing = seen.get(key);
      if (existing) {
        conflicts.push(`${key}: ${existing} and ${command.id}`);
      } else {
        seen.set(key, command.id);
      }
    }

    expect(conflicts).toEqual([]);
  });

  it("gives every command a unique id", () => {
    const ids = APP_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
