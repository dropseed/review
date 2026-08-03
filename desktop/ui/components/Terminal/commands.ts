import { registerContextKey } from "../../commands/contextKeys";
import type { Command, CommandContext } from "../../commands";
import { focusedTerminalId, focusedTerminalTab } from "./close";
import { focusNextNeedsYou } from "./jump";
import { hasNeedsYou } from "./glance";

/**
 * The terminal answers "is a terminal focused?" for the command context.
 *
 * Registered at module scope because it is a DOM probe with no lifecycle —
 * and registered *here* so `commands/` does not have to import the terminal to
 * ask.
 */
registerContextKey("terminalFocused", () => focusedTerminalId() !== null);

function hasRepo(ctx: CommandContext): boolean {
  return !!ctx.store.repoPath;
}

function supported(ctx: CommandContext): boolean {
  return ctx.store.terminalsSupported;
}

/**
 * Split whatever has focus.
 *
 * The terminal tab is resolved from the focused pane rather than from the
 * review being viewed: a pinned tab shows in every repo, so "the tab on
 * screen" and "the tab in this review's bucket" are not the same question.
 */
function split(ctx: CommandContext, orientation: "horizontal" | "vertical") {
  const { store } = ctx;
  if (ctx.keys.terminalFocused) {
    const focused = focusedTerminalTab();
    if (focused) {
      void store.splitTerminal(
        focused.reviewKey,
        focused.tab.id,
        focused.terminalId,
        orientation === "horizontal" ? "row" : "column",
      );
      return;
    }
  }
  store.setSplitOrientation(orientation);
  if (store.secondaryFile === null) store.openEmptySplit();
}

/**
 * Commands the terminal owns, registered while a review is open.
 *
 * ⌘ combinations are not forwarded to the PTY, so these work wherever focus
 * is — which is why they opt into both `allowInTerminal` and `allowInInput`.
 */
export const TERMINAL_COMMANDS: readonly Command[] = [
  {
    id: "view.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    keywords: ["shell", "console"],
    shortcut: { code: "Backquote", mod: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: hasRepo,
    run: ({ store }) => store.toggleTerminalPanel(),
  },
  {
    id: "view.maximizeTerminal",
    title: "Maximize Terminal",
    category: "View",
    // The same act named from the other side: this is also how the diff is
    // collapsed, so it has to be findable by that name too.
    keywords: ["shell", "console", "full", "diff", "code", "collapse", "hide"],
    // iTerm2's maximize-pane chord.
    shortcut: { code: "Enter", mod: true, shift: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: hasRepo,
    run: ({ store }) => store.toggleTerminalPanelMaximized(),
  },
  {
    id: "view.terminalOverview",
    title: "Terminal Overview",
    category: "View",
    keywords: ["mission control", "all terminals", "agents", "sessions"],
    // The panel's own chord, shifted: ⌘` shows the terminal, ⇧⌘` shows all of
    // them.
    shortcut: { code: "Backquote", mod: true, shift: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: hasRepo,
    run: ({ store }) => store.toggleTerminalOverview(),
  },
  {
    id: "go.terminalNeedsYou",
    title: "Next Terminal Needing You",
    category: "Go",
    keywords: ["attention", "waiting", "agent", "claude", "shell", "prompt"],
    // One modifier off ⌘` again: ⌥⌘` walks the queue of shells that want a
    // human — attention first, then prompts — cycling from the focused one.
    shortcut: { code: "Backquote", mod: true, alt: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: (ctx) => hasRepo(ctx) && hasNeedsYou(ctx.store),
    run: () => focusNextNeedsYou(),
  },
  {
    id: "view.splitSideBySide",
    title: "Split Side by Side",
    category: "View",
    shortcut: { code: "KeyD", mod: true },
    // "Split what I'm looking at": a focused terminal splits itself, anything
    // else splits the diff.
    allowInTerminal: true,
    run: (ctx) => split(ctx, "horizontal"),
  },
  {
    id: "view.splitStacked",
    title: "Split Stacked",
    category: "View",
    shortcut: { code: "KeyD", mod: true, shift: true },
    allowInTerminal: true,
    run: (ctx) => split(ctx, "vertical"),
  },
];
