import { getMissingRefs } from "../stores/slices/groupingSlice";
import { getHunkByIdMap } from "../stores/selectors/hunkData";
import { focusedTerminalTab } from "../components/Terminal/close";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";
import type { Command, CommandContext } from "./types";

/** A repository is open. */
function hasRepo(ctx: CommandContext): boolean {
  return !!ctx.store.repoPath;
}

/**
 * There is a diff to act on.
 *
 * When the compared branch is deleted its hunks are still in the store but
 * hidden behind a notice, so acting on them would approve or navigate to
 * things the user cannot see.
 */
function hasDiff(ctx: CommandContext): boolean {
  const { store } = ctx;
  if (!store.repoPath) return false;
  return (
    getMissingRefs(store.reviewMissingRefs, store.repoPath, store.reviewRef)
      .length === 0
  );
}

function focusedHunk(ctx: CommandContext) {
  const { store } = ctx;
  if (!store.focusedHunkId) return null;
  // The map is cached on `filesByPath` identity and already warmed elsewhere;
  // scanning the flat hunk list here ran ~430 comparisons per predicate call,
  // and the predicate runs for every command on every palette open.
  return getHunkByIdMap(store.filesByPath).get(store.focusedHunkId) ?? null;
}

function hasFocusedHunk(ctx: CommandContext): boolean {
  return hasDiff(ctx) && focusedHunk(ctx) !== null;
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
  if (ctx.terminalFocused) {
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
 * The application's commands.
 *
 * This list is the single definition of each action: the palette lists it, the
 * window keydown handler dispatches its shortcut, and the native menu is built
 * from its title, accelerator, and enablement. Previously those lived in six
 * places across two languages and disagreed about availability.
 */
export const APP_COMMANDS: readonly Command[] = [
  // ----- Go -----
  {
    id: "go.file",
    title: "Go to File…",
    category: "Go",
    keywords: ["open", "find", "quick open"],
    shortcut: { code: "KeyP", mod: true },
    isEnabled: hasDiff,
    run: (ctx) => ctx.ui.openFileFinder(),
  },
  {
    id: "go.symbol",
    title: "Go to Symbol…",
    category: "Go",
    keywords: ["function", "class", "definition", "outline"],
    shortcut: { code: "KeyR", mod: true },
    isEnabled: hasDiff,
    run: (ctx) => ctx.ui.openSymbolSearch(),
  },
  {
    id: "go.search",
    title: "Search in Files…",
    category: "Go",
    keywords: ["grep", "find in files", "content"],
    shortcut: { code: "KeyF", mod: true, shift: true },
    isEnabled: hasDiff,
    run: (ctx) => ctx.ui.openContentSearch(),
  },
  {
    id: "go.nextHunk",
    title: "Next Hunk",
    category: "Go",
    shortcut: { code: "KeyJ" },
    isEnabled: hasDiff,
    run: ({ store }) => {
      // In any overlay view, switch to browse first so hunk navigation lands
      // in the single-file viewer rather than getting eaten.
      if (
        store.guideContentMode !== null ||
        store.workingTreeMultiView !== null
      )
        store.navigateToBrowse();
      store.nextHunk();
    },
  },
  {
    id: "go.prevHunk",
    title: "Previous Hunk",
    category: "Go",
    shortcut: { code: "KeyK" },
    isEnabled: hasDiff,
    run: ({ store }) => {
      if (
        store.guideContentMode !== null ||
        store.workingTreeMultiView !== null
      )
        store.navigateToBrowse();
      store.prevHunk();
    },
  },
  {
    id: "go.firstHunkInFile",
    title: "First Hunk in File",
    category: "Go",
    shortcut: { code: "ArrowUp", mod: true },
    isEnabled: hasDiff,
    run: ({ store }) => store.firstHunkInFile(),
  },
  {
    id: "go.lastHunkInFile",
    title: "Last Hunk in File",
    category: "Go",
    shortcut: { code: "ArrowDown", mod: true },
    isEnabled: hasDiff,
    run: ({ store }) => store.lastHunkInFile(),
  },
  {
    id: "go.revealInBrowse",
    title: "Reveal in Browse",
    category: "Go",
    shortcut: { code: "Backslash", mod: true, alt: true },
    isEnabled: (ctx) => hasDiff(ctx) && !!ctx.store.selectedFile,
    run: ({ store }) => {
      if (store.selectedFile) store.revealInBrowse(store.selectedFile);
    },
  },

  // ----- Review -----
  {
    id: "review.approve",
    title: "Approve Hunk",
    category: "Review",
    keywords: ["accept", "ok", "lgtm"],
    shortcut: { code: "KeyA" },
    isEnabled: hasFocusedHunk,
    run: (ctx) => {
      const hunk = focusedHunk(ctx);
      if (!hunk) return;
      ctx.store.approveHunk(hunk.id);
      ctx.store.nextHunkInFile();
    },
  },
  {
    id: "review.reject",
    title: "Reject Hunk",
    category: "Review",
    keywords: ["decline", "request changes"],
    shortcut: { code: "KeyR" },
    isEnabled: hasFocusedHunk,
    run: (ctx) => {
      const hunk = focusedHunk(ctx);
      if (!hunk) return;
      ctx.store.rejectHunk(hunk.id);
      ctx.store.setPendingCommentHunkId(hunk.id);
    },
  },
  {
    id: "review.save",
    title: "Save Hunk for Later",
    category: "Review",
    keywords: ["defer", "bookmark", "later"],
    shortcut: { code: "KeyS" },
    isEnabled: hasFocusedHunk,
    run: (ctx) => {
      const hunk = focusedHunk(ctx);
      if (!hunk) return;
      ctx.store.saveHunkForLater(hunk.id);
    },
  },
  {
    id: "review.undo",
    title: "Undo",
    category: "Review",
    shortcut: { code: "KeyZ" },
    isEnabled: (ctx) => hasDiff(ctx) && ctx.store.undoStack.length > 0,
    run: ({ store }) => store.undo(),
  },
  {
    id: "review.refresh",
    title: "Refresh Review",
    category: "Review",
    keywords: ["reload", "rescan"],
    shortcut: { code: "KeyR", mod: true, shift: true },
    isEnabled: hasRepo,
    run: (ctx) => ctx.ui.refresh(),
  },
  {
    id: "review.new",
    title: "New Review…",
    category: "Review",
    keywords: ["compare", "branch"],
    shortcut: { code: "KeyN", mod: true, shift: true },
    run: (ctx) => ctx.ui.navigate("/new"),
  },

  // ----- View -----
  {
    id: "view.toggleSidebar",
    title: "Toggle Sidebar",
    category: "View",
    keywords: ["rail", "reviews", "hide"],
    shortcut: { code: "KeyB", mod: true },
    run: ({ store }) => store.toggleTabRail(),
  },
  {
    id: "view.toggleOutline",
    title: "Toggle Outline",
    category: "View",
    keywords: ["symbols", "structure"],
    isEnabled: hasDiff,
    run: ({ store }) => store.toggleOutline(),
  },
  {
    id: "view.splitSideBySide",
    title: "Split Side by Side",
    category: "View",
    shortcut: { code: "KeyD", mod: true },
    // "Split what I'm looking at": a focused terminal splits itself, anything
    // else splits the diff.
    allowInTerminal: true,
    isEnabled: (ctx) => ctx.terminalFocused || hasDiff(ctx),
    run: (ctx) => split(ctx, "horizontal"),
  },
  {
    id: "view.splitStacked",
    title: "Split Stacked",
    category: "View",
    shortcut: { code: "KeyD", mod: true, shift: true },
    allowInTerminal: true,
    isEnabled: (ctx) => ctx.terminalFocused || hasDiff(ctx),
    run: (ctx) => split(ctx, "vertical"),
  },
  {
    id: "view.toggleSplitOrientation",
    title: "Toggle Split Orientation",
    category: "View",
    shortcut: { code: "Backslash", mod: true, shift: true },
    isVisible: (ctx) => ctx.store.secondaryFile !== null,
    run: ({ store }) =>
      store.setSplitOrientation(
        store.splitOrientation === "horizontal" ? "vertical" : "horizontal",
      ),
  },
  {
    id: "view.closeSplit",
    title: "Close Split",
    category: "View",
    isVisible: (ctx) => ctx.store.secondaryFile !== null,
    run: ({ store }) => store.closeSplit(),
  },
  {
    id: "view.zoomIn",
    title: "Zoom In",
    category: "View",
    shortcut: { code: "Equal", mod: true },
    run: (ctx) => ctx.ui.zoom("in"),
  },
  {
    id: "view.zoomOut",
    title: "Zoom Out",
    category: "View",
    shortcut: { code: "Minus", mod: true },
    run: (ctx) => ctx.ui.zoom("out"),
  },
  {
    id: "view.zoomReset",
    title: "Actual Size",
    category: "View",
    keywords: ["reset zoom", "100%"],
    shortcut: { code: "Digit0", mod: true },
    run: (ctx) => ctx.ui.zoom("reset"),
  },
  {
    id: "view.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    keywords: ["shell", "console"],
    shortcut: { code: "Backquote", mod: true },
    // Cmd combos are not forwarded to the PTY, so these work wherever focus is.
    allowInTerminal: true,
    allowInInput: true,
    isVisible: (ctx) => ctx.store.terminalsSupported,
    isEnabled: hasRepo,
    run: ({ store }) => store.toggleTerminalPanel(),
  },
  {
    id: "view.maximizeTerminal",
    title: "Maximize Terminal",
    category: "View",
    keywords: ["shell", "console", "full"],
    // iTerm2's maximize-pane chord.
    shortcut: { code: "Enter", mod: true, shift: true },
    allowInTerminal: true,
    allowInInput: true,
    isVisible: (ctx) => ctx.store.terminalsSupported,
    isEnabled: hasRepo,
    run: ({ store }) => store.toggleTerminalPanelMaximized(),
  },

  // ----- Application -----
  {
    id: "app.commandPalette",
    title: "Command Palette…",
    category: "Application",
    keywords: ["commands", "actions", "run"],
    shortcut: { code: "KeyK", mod: true },
    // One shortcut, available everywhere, no exceptions — including from
    // inside a search field or a terminal pane.
    allowInInput: true,
    allowInTerminal: true,
    run: (ctx) => ctx.ui.openCommandPalette(),
  },
  {
    id: "app.openRepo",
    title: "Open Repository…",
    category: "Application",
    keywords: ["folder", "directory", "project"],
    shortcut: { code: "KeyO", mod: true },
    run: (ctx) => ctx.ui.openRepo(),
  },
  {
    id: "app.newTab",
    title: "New Tab",
    category: "Application",
    shortcut: { code: "KeyT", mod: true },
    run: (ctx) => ctx.ui.newTab(),
  },
  {
    id: "app.newWindow",
    title: "New Window",
    category: "Application",
    shortcut: { code: "KeyN", mod: true },
    run: (ctx) => ctx.ui.newWindow(),
  },
  {
    id: "app.closeTab",
    title: "Close",
    category: "Application",
    shortcut: { code: "KeyW", mod: true },
    run: (ctx) => ctx.ui.closeTab(),
  },
  {
    id: "app.settings",
    title: "Settings…",
    category: "Application",
    keywords: ["preferences", "config", "options"],
    shortcut: { code: "Comma", mod: true },
    run: (ctx) => ctx.ui.openSettings(),
  },
  {
    id: "app.debug",
    title: "Show Debug Data",
    category: "Application",
    keywords: ["diagnostics", "state"],
    run: (ctx) => ctx.ui.openDebug(),
  },
  {
    id: "app.restartLsp",
    title: "Restart Language Servers",
    category: "Application",
    keywords: ["lsp", "intellisense"],
    isEnabled: hasRepo,
    run: (ctx) => ctx.ui.restartLsp(),
  },
];

/** Zoom step arithmetic, shared by the command and the native menu event. */
export function nextFontSize(
  current: number,
  direction: "in" | "out" | "reset",
): number {
  if (direction === "reset") return CODE_FONT_SIZE_DEFAULT;
  if (direction === "in")
    return Math.min(current + CODE_FONT_SIZE_STEP, CODE_FONT_SIZE_MAX);
  return Math.max(current - CODE_FONT_SIZE_STEP, CODE_FONT_SIZE_MIN);
}
