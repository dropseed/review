import { registerContextKey } from "../../commands/contextKeys";
import type { Command, CommandContext } from "../../commands";
import {
  focusedTerminalId,
  focusedTerminalTab,
  hasPendingClose,
  undoCloseTerminal,
} from "./close";
import { focusNextNeedsYou, stepTerminalTab, stripTabs } from "./jump";
import { hasNeedsYou } from "./glance";
import { collectLeafIds, expandedLeafIds, type TerminalTab } from "./pane-tree";
import { openTerminalTab } from "./newTab";
import {
  findTab,
  terminalDockPresent,
} from "../../stores/slices/terminalSlice";
import { focusedWorkspaceIn } from "../../stores/selectors/workspaceData";

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
 * Whether there is a panel for these to act on.
 *
 * The panel is docked at the app shell, so this asks the dock's own rule rather
 * than "is a review open" — ⌘` answers on the home screen too, for the same
 * shells, in the same place.
 */
function docked(ctx: CommandContext): boolean {
  return terminalDockPresent(ctx.store);
}

/**
 * The tab the panel is showing, resolved from the store rather than from what
 * has DOM focus.
 *
 * Folding commands can't ask `focusedTerminalId()` the way splitting does: a
 * command run from the ⌘K palette is resolved while the palette's own input
 * holds focus, so a DOM probe answers "no terminal" for every one of them —
 * `isEnabled` included, which would grey the entry out in the only list it
 * appears in. The tab's own `focused` leaf is the same pane anyway.
 */
function activeTerminalTab(store: CommandContext["store"]): TerminalTab | null {
  if (store.contentFocus === "code" || !store.activeTabId) return null;
  return findTab(store.terminalTabs, store.activeTabId);
}

/** How many panes the active tab is drawing — folding needs at least two. */
function foldablePanes(store: CommandContext["store"]): number {
  const active = activeTerminalTab(store);
  return active ? expandedLeafIds(active.root).length : 0;
}

/**
 * Split whatever has focus.
 *
 * The tab is resolved from the focused pane rather than from the active tab:
 * with two panes on screen the one you are typing in is the one to split.
 */
function split(ctx: CommandContext, orientation: "horizontal" | "vertical") {
  const { store } = ctx;
  if (ctx.keys.terminalFocused) {
    const focused = focusedTerminalTab();
    if (focused) {
      void store.splitTerminal(
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

/** Something to split: the terminal you're typing in, or an open repo's diff. */
function splittable(ctx: CommandContext): boolean {
  return ctx.keys.terminalFocused === true || hasRepo(ctx);
}

/**
 * Commands the terminal owns, registered by the app shell — the panel is docked
 * there, so these answer on every route rather than only inside a review.
 *
 * ⌘ combinations are not forwarded to the PTY, so these work wherever focus
 * is — which is why they opt into both `allowInTerminal` and `allowInInput`.
 */
export const TERMINAL_COMMANDS: readonly Command[] = [
  {
    id: "terminal.new",
    title: "New Terminal",
    category: "Terminal",
    keywords: ["shell", "console", "tab", "run", "command line"],
    // ⌘T is the terminal, and there is nothing else it could be: the app has
    // no tabs and no second window. It used to open an app tab unless a
    // terminal pane happened to have DOM focus, which made the app's most
    // common gesture depend on where the caret was; the focused workspace
    // answers "where" instead.
    shortcut: { code: "KeyT", mod: true },
    // Zero questions from anywhere, including from inside a shell or a search
    // field — and never a picker: a shell that landed somewhere else than you
    // wanted is one `cd` away. With no workspace focused it starts in home and
    // the router places it, exactly as it would a shell started outside the
    // app.
    allowInInput: true,
    allowInTerminal: true,
    isVisible: supported,
    run: ({ store }) => {
      void openTerminalTab(focusedWorkspaceIn(store));
    },
  },
  {
    id: "terminal.undoClose",
    title: "Reopen Closed Terminal",
    category: "Terminal",
    keywords: ["undo", "restore", "reopen", "closed", "tab"],
    // The browser's reopen-tab chord. Only for a few seconds after a close —
    // the shell is held that long and then really killed (see
    // `UNDO_CLOSE_TIMEOUT_MS`), so past that there is nothing to reopen.
    shortcut: { code: "KeyT", mod: true, shift: true },
    allowInInput: true,
    allowInTerminal: true,
    isVisible: supported,
    isEnabled: () => hasPendingClose(),
    run: () => {
      undoCloseTerminal();
    },
  },
  {
    id: "terminal.find",
    title: "Find in Terminal",
    category: "Terminal",
    keywords: ["search", "scrollback", "buffer", "grep"],
    shortcut: { code: "KeyF", mod: true },
    allowInTerminal: true,
    // ⌘F is contextual: it belongs to whatever is being read. Gated on a
    // focused terminal so that anywhere else the keystroke falls through
    // untouched to the file viewer's own find bar — which also keeps this
    // entry out of the palette, where "the terminal you're focused in" is
    // never the palette's input. Yes, that is the DOM-probe-in-a-predicate
    // problem `activeTerminalTab` (above) exists to avoid — but here the
    // probe is the point: this gate arbitrates a shared keystroke, not
    // palette enablement, so don't "fix" it to a store read or ⌘F steals
    // the file viewer's find from across the stage.
    isVisible: (ctx) => supported(ctx) && ctx.keys.terminalFocused === true,
    run: ({ store }) => {
      const id = focusedTerminalId();
      if (id) store.setTerminalSearchId(id);
    },
  },
  {
    id: "view.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    // The same act named in focus terms: hiding the terminal is focusing the
    // code, so it has to be findable by that name too.
    keywords: ["shell", "console", "focus", "code", "hide", "show"],
    shortcut: { code: "Backquote", mod: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: docked,
    run: ({ store }) => store.toggleTerminalPanel(),
  },
  {
    id: "view.maximizeTerminal",
    title: "Focus Terminal",
    category: "View",
    // The same act named from the other side: this is also how the code is
    // collapsed, so it has to be findable by those names too.
    keywords: [
      "shell",
      "console",
      "maximize",
      "full",
      "diff",
      "code",
      "collapse",
      "hide",
      "split",
    ],
    // iTerm2's maximize-pane chord.
    shortcut: { code: "Enter", mod: true, shift: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: docked,
    run: ({ store }) => store.toggleTerminalFocus(),
  },
  {
    id: "view.terminalOverview",
    title: "All Terminals",
    category: "View",
    keywords: [
      "overview",
      "everything",
      "grid",
      "side by side",
      "shell",
      "agents",
      "watch",
    ],
    // No chord. The row is a look you take deliberately, not something to land
    // on mid-keystroke — and every ⌘ combination this app could spare is worth
    // more to an action you repeat.
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
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
    isEnabled: (ctx) => docked(ctx) && hasNeedsYou(ctx.store),
    run: () => focusNextNeedsYou(),
  },
  {
    id: "go.prevTerminalTab",
    title: "Previous Terminal Tab",
    category: "Go",
    keywords: ["tab", "shell", "switch", "cycle", "back", "left"],
    // Chrome's own chord for the same act, wrapping the same way — the strip
    // is a row of tabs and this is the gesture a person already has for one.
    shortcut: { code: "ArrowLeft", mod: true, alt: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: (ctx) => docked(ctx) && stripTabs(ctx.store).length > 1,
    run: () => stepTerminalTab(-1),
  },
  {
    id: "go.nextTerminalTab",
    title: "Next Terminal Tab",
    category: "Go",
    keywords: ["tab", "shell", "switch", "cycle", "forward", "right"],
    shortcut: { code: "ArrowRight", mod: true, alt: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: (ctx) => docked(ctx) && stripTabs(ctx.store).length > 1,
    run: () => stepTerminalTab(1),
  },
  {
    id: "view.collapseTerminalPane",
    title: "Collapse Terminal Pane",
    category: "View",
    keywords: ["fold", "minimize", "hide", "shrink", "pane", "shell"],
    // ⌘M minimizes the window; one modifier over folds a pane inside it.
    shortcut: { code: "KeyM", mod: true, alt: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: (ctx) => foldablePanes(ctx.store) > 1,
    run: ({ store }) => {
      const active = activeTerminalTab(store);
      if (active) store.setPaneCollapsed(active.id, active.focused, true);
    },
  },
  {
    id: "view.expandTerminalPanes",
    title: "Expand Collapsed Terminal Panes",
    category: "View",
    keywords: ["unfold", "restore", "show", "pane", "shell"],
    allowInTerminal: true,
    allowInInput: true,
    isVisible: supported,
    isEnabled: (ctx) => {
      const active = activeTerminalTab(ctx.store);
      return (
        !!active &&
        foldablePanes(ctx.store) < collectLeafIds(active.root).length
      );
    },
    // The way back for a tab folded down from the keyboard: the bars are
    // clickable, but a pane collapsed with ⌥⌘M shouldn't need the mouse.
    run: ({ store }) => {
      const active = activeTerminalTab(store);
      if (!active) return;
      const showing = new Set(expandedLeafIds(active.root));
      for (const id of collectLeafIds(active.root)) {
        if (!showing.has(id)) store.setPaneCollapsed(active.id, id, false);
      }
    },
  },
  {
    id: "view.splitSideBySide",
    title: "Split Side by Side",
    category: "View",
    shortcut: { code: "KeyD", mod: true },
    // "Split what I'm looking at": a focused terminal splits itself, anything
    // else splits the diff. Which is also the enablement rule — off a terminal
    // and with no repo open there is nothing on screen to split.
    allowInTerminal: true,
    isEnabled: splittable,
    run: (ctx) => split(ctx, "horizontal"),
  },
  {
    id: "view.splitStacked",
    title: "Split Stacked",
    category: "View",
    shortcut: { code: "KeyD", mod: true, shift: true },
    allowInTerminal: true,
    isEnabled: splittable,
    run: (ctx) => split(ctx, "vertical"),
  },
];
