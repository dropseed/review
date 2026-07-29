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
  label?: string;
  accelerator?: string;
}

/**
 * Menu ids that deliberately have no command.
 *
 * Everything else must be reachable from the palette too — a menu-only action
 * is one the user cannot find by typing its name.
 */
const NOT_COMMANDS = new Set([
  "check_for_updates",
  "review_help",
  "report_issue",
  "install_cli",
]);

/** Pull `.id("x")` / `.accelerator("y")` pairs out of the menu builder. */
function parseMenuItems(source: string): MenuItem[] {
  const items: MenuItem[] = [];
  const builder =
    /MenuItemBuilder::new\(("(?:[^"\\]|\\.)*")?[^)]*\)([\s\S]*?)\.build\(app\)\?/g;

  let match: RegExpExecArray | null;
  while ((match = builder.exec(source)) !== null) {
    const label = match[1]?.slice(1, -1);
    const body = match[2];
    const id = /\.id\("([^"]+)"\)/.exec(body)?.[1];
    if (!id) continue;
    // Rust escapes a backslash accelerator; unescape so it compares to the
    // literal the TypeScript side produces.
    const accelerator = /\.accelerator\("((?:[^"\\]|\\.)*)"\)/
      .exec(body)?.[1]
      ?.replace(/\\\\/g, "\\");
    items.push({ id, label, accelerator });
  }
  return items;
}

const source = readFileSync(MOD_RS, "utf8");
const menuItems = parseMenuItems(source);
const commandsById = new Map(APP_COMMANDS.map((c) => [c.id, c]));

const commandForMenuId = new Map(
  Object.entries(MENU_COMMANDS).map(([menuId, { command }]) => [
    menuId,
    command,
  ]),
);

describe("native menu parity", () => {
  it("finds the menu items in mod.rs", () => {
    // Guards the parser itself — a refactor of the Rust builder that this
    // regex stops understanding must fail loudly, not silently pass.
    expect(menuItems.length).toBeGreaterThan(10);
    expect(menuItems.some((i) => i.id === "find_file")).toBe(true);
  });

  it("routes every menu item to a command, or says why not", () => {
    const unrouted = menuItems
      .filter(
        (item) => !commandForMenuId.has(item.id) && !NOT_COMMANDS.has(item.id),
      )
      .map((item) => item.id);

    expect(unrouted).toEqual([]);
  });

  it("maps every menu item to a command that exists", () => {
    for (const [menuId, { command }] of Object.entries(MENU_COMMANDS)) {
      expect(
        commandsById.has(command),
        `${menuId} maps to unknown command "${command}"`,
      ).toBe(true);
    }
  });

  it("names an event mod.rs actually emits", () => {
    const emitted = new Set(
      [...source.matchAll(/emit_menu_event\(app, "([^"]+)"/g)].map((m) => m[1]),
    );
    const missing = Object.entries(MENU_COMMANDS)
      .filter(([, { event }]) => !emitted.has(event))
      .map(([menuId, { event }]) => `${menuId} → ${event}`);

    expect(missing).toEqual([]);
  });

  it("covers every menu item that carries an accelerator", () => {
    // Deriving the event name from the menu id looks obvious and is wrong:
    // `actual_size` emits `menu:zoom-reset`, `settings` emits
    // `menu:open-settings`. Anything derived silently skipped those, so the
    // guard against accelerator drift did not cover them. Comparing against
    // the explicit map instead makes an uncovered accelerator a failure.
    const uncovered = menuItems
      .filter((item) => item.accelerator && !commandForMenuId.has(item.id))
      .map((item) => `${item.id} (${item.accelerator})`);

    expect(uncovered).toEqual([]);
  });

  it("gives every mapped menu item the same accelerator as its command", () => {
    const mismatches: string[] = [];
    for (const item of menuItems) {
      const commandId = commandForMenuId.get(item.id);
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

  it("gives every mapped menu item the same label as its command", () => {
    // The menu and the palette are two views of one action; two names for it
    // is the same drift as two accelerators, just quieter.
    const mismatches: string[] = [];
    for (const item of menuItems) {
      const commandId = commandForMenuId.get(item.id);
      const command = commandId ? commandsById.get(commandId) : undefined;
      if (!command || !item.label) continue;
      if (item.label !== command.title) {
        mismatches.push(
          `${item.id}: menu says "${item.label}", command says "${command.title}"`,
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
