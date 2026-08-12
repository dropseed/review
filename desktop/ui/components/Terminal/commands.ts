import { registerContextKey } from "../../commands/contextKeys";
import type { Command, CommandContext } from "../../commands";
import { focusedTerminalId, focusedTerminalTab } from "./close";
import { focusNextNeedsYou } from "./jump";
import { hasNeedsYou } from "./glance";
import { collectLeafIds, expandedLeafIds, type TerminalTab } from "./pane-tree";
import {
  mergeVisibleTabs,
  panelReviewKey,
} from "../../stores/slices/terminalSlice";

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
 * The tab the panel is showing, resolved from the store rather than from what
 * has DOM focus.
 *
 * Folding commands can't ask `focusedTerminalId()` the way splitting does: a
 * command run from the ⌘K palette is resolved while the palette's own input
 * holds focus, so a DOM probe answers "no terminal" for every one of them —
 * `isEnabled` included, which would grey the entry out in the only list it
 * appears in. The tab's own `focused` leaf is the same pane anyway.
 */
function activeTerminalTab(
  store: CommandContext["store"],
): { tab: TerminalTab; reviewKey: string } | null {
  if (!store.repoPath || store.terminalPanelMode === "closed") return null;
  const key = panelReviewKey(
    store.terminalCheckouts,
    store.repoPath,
    store.reviewRef,
  );
  // Resolved exactly the way TerminalPanel resolves what it draws, fallback
  // included: a key that owns no tabs of its own never gets an entry in
  // `activeTabIdByReviewKey`, so a repo showing only a pinned visitor would
  // otherwise leave these commands greyed out over a tab plainly on screen.
  // `mergeVisibleTabs` also answers with the key that *owns* each tab, which is
  // the one its layout is stored under.
  const visible = mergeVisibleTabs(store.terminalTabsByReviewKey, key);
  const activeId = store.activeTabIdByReviewKey[key] ?? visible[0]?.tab.id;
  return visible.find((v) => v.tab.id === activeId) ?? null;
}

/** How many panes the active tab is drawing — folding needs at least two. */
function foldablePanes(store: CommandContext["store"]): number {
  const active = activeTerminalTab(store);
  return active ? expandedLeafIds(active.tab.root).length : 0;
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
      if (active) {
        store.setPaneCollapsed(
          active.reviewKey,
          active.tab.id,
          active.tab.focused,
          true,
        );
      }
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
        foldablePanes(ctx.store) < collectLeafIds(active.tab.root).length
      );
    },
    // The way back for a tab folded down from the keyboard: the bars are
    // clickable, but a pane collapsed with ⌥⌘M shouldn't need the mouse.
    run: ({ store }) => {
      const active = activeTerminalTab(store);
      if (!active) return;
      const showing = new Set(expandedLeafIds(active.tab.root));
      for (const id of collectLeafIds(active.tab.root)) {
        if (!showing.has(id)) {
          store.setPaneCollapsed(active.reviewKey, active.tab.id, id, false);
        }
      }
    },
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
