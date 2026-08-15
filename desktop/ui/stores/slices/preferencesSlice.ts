import { invoke } from "@tauri-apps/api/core";
import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import type { RecentRepo } from "../../utils/preferences";
import { setSentryConsent } from "../../utils/sentry";
import { setSoundEnabled } from "../../utils/sounds";
import { setTerminalNotificationsEnabled as setTerminalNotifications } from "../../utils/terminal-notifications";
import {
  refreshAllTerminalOptions,
  refreshAllTerminalThemes,
  type TerminalFontOptions,
} from "../../components/Terminal/registry";
import type { FontWeight } from "@xterm/xterm";
import {
  applyUiTheme,
  getUiTheme,
  setCustomThemes,
  type UiTheme,
} from "../../lib/ui-themes";
import {
  matchBundledTheme,
  resolveVscodeTheme,
  type VscodeThemeDetection,
} from "../../lib/vscode-theme-resolver";
import {
  SIDEBAR_LIMITS,
  clampFraction,
  type SidebarWidthKey,
} from "../../utils/resize";

/** Parse a hex color string (e.g., "#1e1e1e") to { r, g, b }. */
function parseHexColor(
  hex: string,
): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/** Set the native window background to match a theme's surface color. */
function applyWindowBackgroundColor(surfaceHex: string): void {
  const rgb = parseHexColor(surfaceHex);
  if (rgb) {
    invoke("set_window_background_color", rgb).catch(() => {});
  }
}

/**
 * Apply a theme to every surface that wears it: the CSS variables, the live
 * terminals, and the native window background.
 *
 * That last one is not decoration. The macOS title bar is `Transparent`, so it
 * draws in the window's background color rather than system chrome — setting it
 * is what keeps the top edge of the window part of the app instead of a strip
 * bolted above it. Every path that changes the theme goes through here, because
 * a path that forgets leaves the bar showing the previous theme's color.
 */
function applyTheme(theme: UiTheme): void {
  applyUiTheme(theme);
  refreshAllTerminalThemes();
  applyWindowBackgroundColor(theme.tokens.surface);
}

/** Apply a resolved VS Code theme: set CSS variables, window background, and persist code theme. */
function applyResolvedVscodeTheme(
  theme: UiTheme,
  storage: StorageService,
): void {
  applyTheme(theme);
  storage.set("codeTheme", theme.codeTheme);
  console.log(
    `[preferences] Applied VS Code theme "${theme.label}" → "${theme.id}"`,
  );
}

/** Apply --code-font-family CSS variable. */
function applyFontFamilyCssVariables(family: string): void {
  document.documentElement.style.setProperty("--code-font-family", family);
}

/** Apply code font size CSS variables (--code-font-size and --ui-scale). */
function applyFontSizeCssVariables(size: number): void {
  document.documentElement.style.setProperty("--code-font-size", `${size}px`);
  document.documentElement.style.setProperty(
    "--ui-scale",
    String(size / CODE_FONT_SIZE_DEFAULT),
  );
}

/** Collect the terminal font/spacing prefs into the shape the registry applies. */
function buildTerminalFontOptions(s: {
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalFontWeight: FontWeight;
  terminalLineHeight: number;
  terminalLetterSpacing: number;
}): TerminalFontOptions {
  return {
    fontFamily: s.terminalFontFamily,
    fontSize: s.terminalFontSize,
    fontWeight: s.terminalFontWeight,
    fontWeightBold: TERMINAL_FONT_WEIGHT_BOLD,
    lineHeight: s.terminalLineHeight,
    letterSpacing: s.terminalLetterSpacing,
  };
}

/**
 * Detect the active VS Code theme via the Rust backend and resolve it
 * to a UiTheme. Returns null if detection fails or VS Code is not active.
 */
async function fetchAndResolveVscodeTheme(): Promise<UiTheme | null> {
  try {
    const detection: VscodeThemeDetection = await invoke("detect_vscode_theme");
    return matchBundledTheme(detection.name) ?? resolveVscodeTheme(detection);
  } catch (e) {
    console.warn("[preferences] Failed to detect VS Code theme:", e);
    return null;
  }
}

export const CODE_FONT_SIZE_DEFAULT = 11;
export const CODE_FONT_SIZE_MIN = 8;
export const CODE_FONT_SIZE_MAX = 32;
export const CODE_FONT_SIZE_STEP = 1;

export const CODE_FONT_FAMILY_DEFAULT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

// Terminal font/rendering defaults. These are intentionally separate from the
// code-font settings above so the embedded terminal can be tuned to read like a
// native terminal without disturbing the diff/code viewer.
//
// JetBrains Mono is bundled (imported from main.tsx) rather than relying on the system
// stack, so the grid measures the same on every machine — the same reason
// Ghostty ships it as its own default. The system fonts stay behind it as a
// fallback for anything the bundled subsets don't cover.
export const TERMINAL_FONT_FAMILY_DEFAULT =
  "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;
export const TERMINAL_FONT_SIZE_STEP = 1;
export const TERMINAL_FONT_WEIGHT_DEFAULT: FontWeight = 400;
/** Bold weight is fixed (not a user preference) — normal text carries the tuning. */
export const TERMINAL_FONT_WEIGHT_BOLD: FontWeight = 700;
export const TERMINAL_LINE_HEIGHT_DEFAULT = 1.0;
export const TERMINAL_LINE_HEIGHT_MIN = 1.0;
export const TERMINAL_LINE_HEIGHT_MAX = 1.6;
export const TERMINAL_LINE_HEIGHT_STEP = 0.05;
export const TERMINAL_LETTER_SPACING_DEFAULT = 0;
export const TERMINAL_LETTER_SPACING_MIN = -2;
export const TERMINAL_LETTER_SPACING_MAX = 4;
export const TERMINAL_LETTER_SPACING_STEP = 0.5;

const MAX_RECENT_REPOS = 5;

/** Extract lowercase file extension (without dot) from a file path, or empty string. */
function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const lastSlash = filePath.lastIndexOf("/");
  if (lastDot > lastSlash) {
    return filePath.slice(lastDot + 1).toLowerCase();
  }
  return "";
}

/** Resolve the effective diff view mode for a file, checking per-extension overrides first. */
export function resolveViewModeForFile(
  filePath: string,
  diffViewMode: DiffViewMode,
  diffViewModeByExtension: Record<string, DiffViewMode>,
): DiffViewMode {
  const ext = getFileExtension(filePath);
  if (ext && ext in diffViewModeByExtension) {
    return diffViewModeByExtension[ext];
  }
  return diffViewMode;
}

export type DiffLineDiffType = "word" | "word-alt" | "char" | "none";
export type DiffOverflow = "scroll" | "wrap";
export type ChangesDisplayMode = "tree" | "flat";
export type DiffViewMode = "unified" | "split" | "old" | "new";
export type FileSortOrder = "name" | "size" | "modified";

const defaults = {
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeFontFamily: CODE_FONT_FAMILY_DEFAULT,
  terminalFontFamily: TERMINAL_FONT_FAMILY_DEFAULT,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalFontWeight: TERMINAL_FONT_WEIGHT_DEFAULT as FontWeight,
  terminalLineHeight: TERMINAL_LINE_HEIGHT_DEFAULT,
  terminalLetterSpacing: TERMINAL_LETTER_SPACING_DEFAULT,
  terminalLaunchCommand: "",
  usagePinnedWindows: {} as Record<string, string>,
  codeTheme: "github-dark",
  uiTheme: "review-dark",
  recentRepositories: [] as RecentRepo[],
  diffLineDiffType: "word" as DiffLineDiffType,
  diffOverflow: "scroll" as DiffOverflow,
  changesDisplayMode: "tree" as ChangesDisplayMode,
  gitDisplayMode: "tree" as ChangesDisplayMode,
  diffViewMode: "split" as DiffViewMode,
  diffViewModeByExtension: {} as Record<string, DiffViewMode>,
  sentryEnabled: false,
  soundEffectsEnabled: true,
  terminalNotificationsEnabled: true,
  tabRailCollapsed: false,
  filesPanelCollapsed: false,
  // No `reviewSortOrder`: the sort menu is gone, and a stored "size" would
  // otherwise keep reordering rows with nothing left to change it back. The
  // key stays on disk untouched — inert, and still there if the control ever
  // returns.

  // No `expandedRepos` / `collapsedOrgs`: the repos list they belonged to is
  // gone, and ⌘K is where its rows are read now. Both keys stay on disk,
  // inert, like `collapsedRepos` before them.

  // When the user last looked at each workspace, as epoch ms. What makes an
  // attention signal *unseen*: a card that started waiting after the last time
  // its owner looked at it wears an accent until they look again.
  //
  // A preference rather than anything in `work.json` on purpose — this is a
  // fact about one pair of eyes, not about the work. A second machine
  // reasonably has its own answer, and nothing here is worth a queue write.
  workspaceSeenAt: {} as Record<string, number>,
  fileSortOrder: "name" as FileSortOrder,
  guideSideNavCollapsed: false,
  guideSideNavWidth: 240,
  matchVscodeTheme: false,
  showOutline: false,
  lspDisabledLanguages: [] as string[],
  // Split sizes. Side panels are absolute (rem, so they track the UI scale);
  // content splits are fractions. See utils/resize.ts for why.
  //
  // `tabRail*` is historical — the left sidebar was a tab rail before it was
  // the workspace queue. The key is what the user's stored width is filed
  // under, so it stays as it is: renaming it would silently reset everyone's
  // sidebar to the default in exchange for nothing.
  tabRailWidth: SIDEBAR_LIMITS.left.defaultRem,
  filesPanelWidth: SIDEBAR_LIMITS.right.defaultRem,
  diffSplitFraction: 0.5,
};

export interface PreferencesSlice {
  // UI settings
  codeFontSize: number;
  codeFontFamily: string;

  // Terminal font/rendering settings (independent of the code font)
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalFontWeight: FontWeight;
  terminalLineHeight: number;
  terminalLetterSpacing: number;
  /**
   * Command typed at the prompt of every terminal this app starts (e.g.
   * `claude`). Empty means plain shell.
   */
  terminalLaunchCommand: string;

  /**
   * Which usage window each agent's compact bar plots, by agent id → window
   * label. Absent means the agent's own headline window.
   */
  usagePinnedWindows: Record<string, string>;

  codeTheme: string;
  uiTheme: string;
  fileToReveal: string | null;
  directoryToReveal: string | null;

  // Diff display settings
  diffLineDiffType: DiffLineDiffType;
  diffOverflow: DiffOverflow;

  // Changes panel display mode (per panel)
  changesDisplayMode: ChangesDisplayMode;
  gitDisplayMode: ChangesDisplayMode;

  // Diff view mode
  diffViewMode: DiffViewMode;
  diffViewModeByExtension: Record<string, DiffViewMode>;

  // Recent repositories
  recentRepositories: RecentRepo[];

  // Crash reporting
  sentryEnabled: boolean;

  // Sound effects
  soundEffectsEnabled: boolean;

  // OS notifications when a background terminal needs attention
  terminalNotificationsEnabled: boolean;

  // Tab rail
  tabRailCollapsed: boolean;

  // Files panel (right sidebar)
  filesPanelCollapsed: boolean;

  // When each workspace was last focused, as epoch ms. Absent = never looked.
  workspaceSeenAt: Record<string, number>;

  // File sort order (shared across browse + changes tabs)
  fileSortOrder: FileSortOrder;

  // Guide side nav
  guideSideNavCollapsed: boolean;
  guideSideNavWidth: number;

  // VS Code theme matching
  matchVscodeTheme: boolean;
  /** The currently resolved VS Code theme (null when not using VS Code match) */
  resolvedVscodeTheme: UiTheme | null;

  // Symbol outline panel
  showOutline: boolean;

  // LSP disabled languages
  lspDisabledLanguages: string[];

  /**
   * Chosen width of each side panel, in rem. This is the width the user picked,
   * not necessarily the one on screen — a window too narrow to honor it renders
   * a clamped width without overwriting the choice, so it comes back intact on
   * the display it was chosen for.
   */
  tabRailWidth: number;
  filesPanelWidth: number;

  /** Diff primary/secondary split, as the primary pane's share (0..1). */
  diffSplitFraction: number;

  /** True once loadPreferences() has completed (theme, fonts, etc. are ready) */
  preferencesLoaded: boolean;

  // Actions
  setCodeFontSize: (size: number) => void;
  setCodeFontFamily: (family: string) => void;
  setTerminalFontFamily: (family: string) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalFontWeight: (weight: FontWeight) => void;
  setTerminalLineHeight: (lineHeight: number) => void;
  setTerminalLetterSpacing: (spacing: number) => void;
  setTerminalLaunchCommand: (command: string) => void;
  /** Pin the usage window an agent's sidebar bar plots; null restores the default. */
  setUsagePinnedWindow: (agentId: string, windowLabel: string | null) => void;
  setCodeTheme: (theme: string) => void;
  setUiTheme: (themeId: string) => void;
  setDiffLineDiffType: (type: DiffLineDiffType) => void;
  setDiffOverflow: (overflow: DiffOverflow) => void;
  setChangesDisplayMode: (mode: ChangesDisplayMode) => void;
  setGitDisplayMode: (mode: ChangesDisplayMode) => void;
  setDiffViewMode: (mode: DiffViewMode) => void;
  setDiffViewModeForFile: (filePath: string, mode: DiffViewMode) => void;
  loadPreferences: () => Promise<void>;
  revealFileInTree: (path: string) => void;
  clearFileToReveal: () => void;
  revealDirectoryInTree: (path: string) => void;
  clearDirectoryToReveal: () => void;

  // Recent repositories actions
  addRecentRepository: (path: string) => Promise<void>;
  removeRecentRepository: (path: string) => void;

  // Crash reporting actions
  setSentryEnabled: (enabled: boolean) => void;

  // Sound effects actions
  setSoundEffectsEnabled: (enabled: boolean) => void;

  // Terminal notification actions
  setTerminalNotificationsEnabled: (enabled: boolean) => void;

  // Tab rail actions
  setTabRailCollapsed: (collapsed: boolean) => void;
  toggleTabRail: () => void;

  // Files panel actions
  setFilesPanelCollapsed: (collapsed: boolean) => void;
  toggleFilesPanel: () => void;

  /**
   * Acknowledge a workspace: whatever it was signalling has now been seen.
   *
   * `live` is the queue as it stands, so entries for workspaces that no longer
   * exist go with the write rather than accumulating forever.
   */
  markWorkspaceSeen: (workspaceId: string, live: readonly string[]) => void;

  // File sort order actions
  setFileSortOrder: (order: FileSortOrder) => void;

  // Guide side nav actions
  setGuideSideNavCollapsed: (collapsed: boolean) => void;
  toggleGuideSideNav: () => void;
  setGuideSideNavWidth: (width: number) => void;

  // VS Code theme matching actions
  setMatchVscodeTheme: (enabled: boolean) => Promise<void>;
  detectAndApplyVscodeTheme: () => Promise<void>;

  // Symbol outline actions
  setShowOutline: (show: boolean) => void;
  toggleOutline: () => void;

  // LSP disabled languages actions
  setLspDisabledLanguages: (languages: string[]) => void;

  // Split size actions
  setSidebarWidth: (key: SidebarWidthKey, widthRem: number) => void;
  setDiffSplitFraction: (fraction: number) => void;
}

export const createPreferencesSlice: SliceCreatorWithStorage<
  PreferencesSlice
> = (storage: StorageService) => (set, get) => {
  return {
    ...defaults,
    fileToReveal: null,
    directoryToReveal: null,
    resolvedVscodeTheme: null,
    preferencesLoaded: false,

    setCodeFontSize: (size) => {
      set({ codeFontSize: size });
      storage.set("codeFontSize", size);
      applyFontSizeCssVariables(size);
    },

    setCodeFontFamily: (family) => {
      set({ codeFontFamily: family });
      storage.set("codeFontFamily", family);
      applyFontFamilyCssVariables(family);
    },

    setTerminalFontFamily: (family) => {
      set({ terminalFontFamily: family });
      storage.set("terminalFontFamily", family);
      refreshAllTerminalOptions(buildTerminalFontOptions(get()));
    },

    setTerminalFontSize: (size) => {
      set({ terminalFontSize: size });
      storage.set("terminalFontSize", size);
      refreshAllTerminalOptions(buildTerminalFontOptions(get()));
    },

    setTerminalFontWeight: (weight) => {
      set({ terminalFontWeight: weight });
      storage.set("terminalFontWeight", weight);
      refreshAllTerminalOptions(buildTerminalFontOptions(get()));
    },

    setTerminalLineHeight: (lineHeight) => {
      set({ terminalLineHeight: lineHeight });
      storage.set("terminalLineHeight", lineHeight);
      refreshAllTerminalOptions(buildTerminalFontOptions(get()));
    },

    setTerminalLetterSpacing: (spacing) => {
      set({ terminalLetterSpacing: spacing });
      storage.set("terminalLetterSpacing", spacing);
      refreshAllTerminalOptions(buildTerminalFontOptions(get()));
    },

    setTerminalLaunchCommand: (command) => {
      // Only new terminals pick this up — running sessions are left alone.
      set({ terminalLaunchCommand: command });
      storage.set("terminalLaunchCommand", command);
    },

    setUsagePinnedWindow: (agentId, windowLabel) => {
      // Keyed by label rather than index: an agent can add or drop a window
      // between reads, and a stale index would silently plot the wrong one.
      const next = { ...get().usagePinnedWindows };
      if (windowLabel === null) delete next[agentId];
      else next[agentId] = windowLabel;
      set({ usagePinnedWindows: next });
      storage.set("usagePinnedWindows", next);
    },

    setCodeTheme: (theme) => {
      set({ codeTheme: theme });
      storage.set("codeTheme", theme);
    },

    setUiTheme: (themeId) => {
      const theme = getUiTheme(themeId);
      set({
        uiTheme: themeId,
        codeTheme: theme.codeTheme,
        matchVscodeTheme: false,
        resolvedVscodeTheme: null,
      });
      storage.set("uiTheme", themeId);
      storage.set("codeTheme", theme.codeTheme);
      storage.set("matchVscodeTheme", false);
      applyTheme(theme);
    },

    setDiffLineDiffType: (type) => {
      set({ diffLineDiffType: type });
      storage.set("diffLineDiffType", type);
    },

    setDiffOverflow: (overflow) => {
      set({ diffOverflow: overflow });
      storage.set("diffOverflow", overflow);
    },

    setChangesDisplayMode: (mode) => {
      set({ changesDisplayMode: mode });
      storage.set("changesDisplayMode", mode);
    },

    setGitDisplayMode: (mode) => {
      set({ gitDisplayMode: mode });
      storage.set("gitDisplayMode", mode);
    },

    setDiffViewMode: (mode) => {
      set({ diffViewMode: mode });
      storage.set("diffViewMode", mode);
    },

    setDiffViewModeForFile: (filePath, mode) => {
      const ext = getFileExtension(filePath);
      if (ext) {
        const byExt = { ...get().diffViewModeByExtension, [ext]: mode };
        set({ diffViewModeByExtension: byExt });
        storage.set("diffViewModeByExtension", byExt);
      } else {
        // Extensionless files (Makefile, Dockerfile, etc.) — set global default
        set({ diffViewMode: mode });
        storage.set("diffViewMode", mode);
      }
    },

    loadPreferences: async () => {
      // Read settings file for custom themes
      let settings: Record<string, unknown> | null = null;
      try {
        settings = await invoke<Record<string, unknown> | null>(
          "read_settings",
        );
      } catch {
        // read_settings failed — continue with defaults
      }

      // Load all standard keys in parallel, falling back to defaults
      const keys = Object.keys(defaults) as (keyof typeof defaults)[];
      const values = await Promise.all(keys.map((key) => storage.get(key)));
      const loaded = Object.fromEntries(
        keys.map((key, i) => [key, values[i] ?? defaults[key]]),
      ) as typeof defaults;

      // Migrate legacy "file" diff view mode to "new"
      if ((loaded.diffViewMode as string) === "file") {
        loaded.diffViewMode = "new";
      }

      // Load custom themes from settings before any theme resolution
      if (settings && Array.isArray(settings["customThemes"])) {
        setCustomThemes(
          settings["customThemes"] as Array<{
            name: string;
            type: string;
            colors: Record<string, string>;
            tokenColors: unknown[];
          }>,
        );
      }

      // Resolve VS Code theme before setting state so we don't flash
      // the fallback theme (the persisted codeTheme may reference a custom
      // Shiki theme that hasn't been re-registered yet — REVIEW-9).
      const resolvedVscode = loaded.matchVscodeTheme
        ? await fetchAndResolveVscodeTheme()
        : null;

      set({
        ...loaded,
        codeTheme: resolvedVscode?.codeTheme ?? loaded.codeTheme,
        resolvedVscodeTheme: resolvedVscode,
      });

      // Propagate Sentry consent to both JS and Rust SDKs
      setSentryConsent(loaded.sentryEnabled);
      invoke("set_sentry_consent", { enabled: loaded.sentryEnabled }).catch(
        () => {},
      );

      // Propagate sound setting
      setSoundEnabled(loaded.soundEffectsEnabled);
      setTerminalNotifications(loaded.terminalNotificationsEnabled);

      applyFontSizeCssVariables(loaded.codeFontSize);
      applyFontFamilyCssVariables(loaded.codeFontFamily);

      // Apply UI theme (sets all semantic CSS variables + color-scheme)
      if (resolvedVscode) {
        applyResolvedVscodeTheme(resolvedVscode, storage);
      } else {
        applyTheme(getUiTheme(loaded.uiTheme));
      }

      set({ preferencesLoaded: true });
    },

    revealFileInTree: (path) => {
      // Sets selectedFile from NavigationSlice via type assertion (cross-slice update)
      set({
        fileToReveal: path,
        selectedFile: path,
      } as Partial<PreferencesSlice>);
    },

    clearFileToReveal: () => {
      set({ fileToReveal: null });
    },

    revealDirectoryInTree: (path) => {
      set({ directoryToReveal: path });
    },

    clearDirectoryToReveal: () => {
      set({ directoryToReveal: null });
    },

    addRecentRepository: async (path) => {
      // Read directly from storage to avoid race with loadPreferences
      const stored =
        (await storage.get<RecentRepo[]>("recentRepositories")) ?? [];
      const name = path.split("/").pop() || path;
      const now = new Date().toISOString();

      const filtered = stored.filter((r) => r.path !== path);
      const updated: RecentRepo[] = [
        { path, name, lastOpened: now },
        ...filtered,
      ].slice(0, MAX_RECENT_REPOS);

      set({ recentRepositories: updated });
      storage.set("recentRepositories", updated);

      // Opening a repo is enough to keep it in the sidebar — no review needed.
      get().registerRepo(path);
    },

    removeRecentRepository: (path) => {
      const current = get().recentRepositories;
      const updated = current.filter((r) => r.path !== path);
      set({ recentRepositories: updated });
      storage.set("recentRepositories", updated);
    },

    setSentryEnabled: (enabled) => {
      set({ sentryEnabled: enabled });
      storage.set("sentryEnabled", enabled);
      setSentryConsent(enabled);
      invoke("set_sentry_consent", { enabled }).catch(() => {});
    },

    setSoundEffectsEnabled: (enabled) => {
      set({ soundEffectsEnabled: enabled });
      storage.set("soundEffectsEnabled", enabled);
      setSoundEnabled(enabled);
    },

    setTerminalNotificationsEnabled: (enabled) => {
      set({ terminalNotificationsEnabled: enabled });
      storage.set("terminalNotificationsEnabled", enabled);
      setTerminalNotifications(enabled);
    },

    setTabRailCollapsed: (collapsed) => {
      set({ tabRailCollapsed: collapsed });
      storage.set("tabRailCollapsed", collapsed);
    },

    toggleTabRail: () => {
      get().setTabRailCollapsed(!get().tabRailCollapsed);
    },

    setFilesPanelCollapsed: (collapsed) => {
      set({ filesPanelCollapsed: collapsed });
      storage.set("filesPanelCollapsed", collapsed);
    },

    toggleFilesPanel: () => {
      get().setFilesPanelCollapsed(!get().filesPanelCollapsed);
    },

    markWorkspaceSeen: (workspaceId, live) => {
      const keep = new Set(live);
      const next: Record<string, number> = { [workspaceId]: Date.now() };
      for (const [id, at] of Object.entries(get().workspaceSeenAt)) {
        if (id !== workspaceId && keep.has(id)) next[id] = at;
      }
      set({ workspaceSeenAt: next });
      storage.set("workspaceSeenAt", next);
    },

    setFileSortOrder: (order) => {
      set({ fileSortOrder: order });
      storage.set("fileSortOrder", order);
    },

    setGuideSideNavCollapsed: (collapsed) => {
      set({ guideSideNavCollapsed: collapsed });
      storage.set("guideSideNavCollapsed", collapsed);
    },

    toggleGuideSideNav: () => {
      get().setGuideSideNavCollapsed(!get().guideSideNavCollapsed);
    },

    setGuideSideNavWidth: (width) => {
      set({ guideSideNavWidth: width });
      storage.set("guideSideNavWidth", width);
    },

    setMatchVscodeTheme: async (enabled) => {
      set({ matchVscodeTheme: enabled });
      storage.set("matchVscodeTheme", enabled);
      if (enabled) {
        await get().detectAndApplyVscodeTheme();
      } else {
        // Revert to the selected bundled theme
        const theme = getUiTheme(get().uiTheme);
        set({ resolvedVscodeTheme: null, codeTheme: theme.codeTheme });
        storage.set("codeTheme", theme.codeTheme);
        applyTheme(theme);
      }
    },

    setShowOutline: (show) => {
      set({ showOutline: show });
      storage.set("showOutline", show);
    },

    toggleOutline: () => {
      get().setShowOutline(!get().showOutline);
    },

    detectAndApplyVscodeTheme: async () => {
      const resolved = await fetchAndResolveVscodeTheme();
      if (!resolved) return;

      set({
        resolvedVscodeTheme: resolved,
        codeTheme: resolved.codeTheme,
      });
      applyResolvedVscodeTheme(resolved, storage);
    },

    setLspDisabledLanguages: (languages) => {
      set({ lspDisabledLanguages: languages });
      storage.set("lspDisabledLanguages", languages);
    },

    setSidebarWidth: (key, widthRem) => {
      if (get()[key] === widthRem) return;
      set({ [key]: widthRem } as Partial<PreferencesSlice>);
      // Called once per animation frame while dragging; the storage layer
      // debounces its own disk writes, so this is a memory write per frame.
      storage.set(key, widthRem);
    },

    setDiffSplitFraction: (fraction) => {
      const clamped = clampFraction(fraction);
      if (get().diffSplitFraction === clamped) return;
      set({ diffSplitFraction: clamped });
      storage.set("diffSplitFraction", clamped);
    },
  };
};
