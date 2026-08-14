import { getMissingRefs } from "../stores/slices/groupingSlice";
import { getHunkByIdMap } from "../stores/selectors/hunkData";
import { activeContentOverlay } from "../stores/slices/navigationSlice";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
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
    id: "go.workspace",
    title: "Go to…",
    category: "Go",
    keywords: ["workspace", "branch", "repo", "terminal", "switch", "jump"],
    // ⌘K is navigation now, not the command list: the app has one axis, and
    // the thing you press most often is moving along it. `>` inside the dialog
    // is still the way to the commands (as is ⇧⌘P).
    shortcut: { code: "KeyK", mod: true },
    allowInInput: true,
    allowInTerminal: true,
    run: (ctx) => ctx.ui.openPalette("go"),
  },
  {
    id: "go.file",
    title: "Go to File…",
    category: "Go",
    keywords: ["open", "find", "quick open"],
    shortcut: { code: "KeyP", mod: true },
    isEnabled: hasDiff,
    run: (ctx) => ctx.ui.openPalette("files"),
  },
  {
    id: "go.symbol",
    title: "Go to Symbol…",
    category: "Go",
    keywords: ["function", "class", "definition", "outline"],
    shortcut: { code: "KeyR", mod: true },
    isEnabled: hasDiff,
    run: (ctx) => ctx.ui.openPalette("symbols"),
  },
  {
    id: "go.search",
    title: "Search in Files…",
    category: "Go",
    keywords: ["grep", "find in files", "content", "results"],
    shortcut: { code: "KeyF", mod: true, shift: true },
    isEnabled: hasDiff,
    // The full results view, not the palette: matches are lines, and reading
    // one in a dropdown row means reading it truncated. The palette still has
    // content search behind `#` for when you know what you are jumping to.
    run: ({ store }) => store.openSearchView(),
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
      if (activeContentOverlay(store)) store.navigateToBrowse();
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
      if (activeContentOverlay(store)) store.navigateToBrowse();
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
    id: "view.toggleFilesPanel",
    title: "Toggle Files Panel",
    category: "View",
    keywords: ["files", "sidebar", "browse", "hide", "right"],
    // ⌘B collapses the left sidebar; the right one takes the same chord with
    // Option, so the two panels that flank the diff are one modifier apart.
    shortcut: { code: "KeyB", mod: true, alt: true },
    // Only the review screen has this panel, and collapsing is persisted — from
    // anywhere else this would silently change what you see next time instead
    // of doing nothing visible now.
    isEnabled: hasRepo,
    run: ({ store }) => store.toggleFilesPanel(),
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
  // ----- Application -----
  {
    id: "app.commandPalette",
    title: "Command Palette…",
    category: "Application",
    keywords: ["commands", "actions", "run"],
    shortcut: { code: "KeyP", mod: true, shift: true },
    // One shortcut, available everywhere, no exceptions — including from
    // inside a search field or a terminal pane.
    allowInInput: true,
    allowInTerminal: true,
    run: (ctx) => ctx.ui.openPalette("commands"),
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
    // ⌘T belongs to `terminal.new` now: opening a shell is the gesture this
    // app is asked for constantly, and an app tab is not.
    shortcut: { code: "KeyT", mod: true, shift: true },
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
    run: (ctx) => ctx.ui.openOverlay("settings"),
  },
  {
    id: "app.debug",
    title: "Show Debug Data",
    category: "Application",
    keywords: ["diagnostics", "state"],
    run: (ctx) => ctx.ui.openOverlay("debug"),
  },
  // ----- Repository -----
  //
  // Both of these belonged to the sidebar's repo tree, which is gone. They are
  // repo-level rather than review-level, and the app has exactly one repo in
  // view at a time — whichever repo tab is active — so ⌘K is
  // where they live now rather than a menu on a list that no longer exists.
  {
    id: "repo.fetch",
    title: "Fetch from Origin",
    category: "Repository",
    keywords: ["git", "pull", "remote", "refresh", "update", "origin"],
    isEnabled: hasRepo,
    run: async ({ store }) => {
      const repoPath = store.repoPath;
      if (!repoPath) return;
      await getApiClient().fetchOrigin(repoPath);
      await store.loadLocalActivity();
    },
  },
  {
    id: "repo.forget",
    title: "Forget Repository…",
    category: "Repository",
    keywords: ["remove", "unregister", "hide", "sidebar", "browse"],
    isEnabled: hasRepo,
    // Unregistering is what decides whether ⌘K can find a repo's branches at
    // all — the registry behind `listAllLocalActivity` is every list the app
    // builds. Nothing on disk is touched: the reviews stay, and opening the
    // repo again re-registers it.
    run: async ({ store }) => {
      const repoPath = store.repoPath;
      if (!repoPath) return;
      const ok = await getPlatformServices().dialogs.confirm(
        `Stop listing ${repoPath} in Review?\n\nIts reviews stay on disk, and opening it again brings it back.`,
        "Forget repository",
      );
      if (!ok) return;
      await store.unregisterRepo(repoPath);
    },
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
