import { invoke } from "@tauri-apps/api/core";
import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import type { RecentRepo } from "../../utils/preferences";
import { setSentryConsent } from "../../utils/sentry";
import { setSoundEnabled } from "../../utils/sounds";
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

/** Apply a resolved VS Code theme: set CSS variables, window background, and persist code theme. */
function applyResolvedVscodeTheme(
  theme: UiTheme,
  storage: StorageService,
): void {
  applyUiTheme(theme);
  applyWindowBackgroundColor(theme.tokens.surface);
  storage.set("codeTheme", theme.codeTheme);
  console.log(
    `[preferences] Applied VS Code theme "${theme.label}" → "${theme.id}"`,
  );
}

/** Apply code font size CSS variables (--code-font-size and --ui-scale). */
function applyFontSizeCssVariables(size: number): void {
  document.documentElement.style.setProperty("--code-font-size", `${size}px`);
  document.documentElement.style.setProperty(
    "--ui-scale",
    String(size / CODE_FONT_SIZE_DEFAULT),
  );
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

const MAX_RECENT_REPOS = 5;

export type DiffLineDiffType = "word" | "word-alt" | "char" | "none";
export type DiffIndicators = "classic" | "bars" | "none";
export type ChangesDisplayMode = "tree" | "flat";
export type DiffViewMode = "unified" | "split" | "old" | "new";
export type ReviewSortOrder = "updated" | "repo" | "size";

const defaults = {
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  uiTheme: "review-dark",
  recentRepositories: [] as RecentRepo[],
  diffLineDiffType: "word" as DiffLineDiffType,
  diffIndicators: "bars" as DiffIndicators,
  changesDisplayMode: "tree" as ChangesDisplayMode,
  gitDisplayMode: "tree" as ChangesDisplayMode,
  diffViewMode: "split" as DiffViewMode,
  sentryEnabled: false,
  soundEffectsEnabled: true,
  tabRailCollapsed: false,
  filesPanelCollapsed: false,
  reviewSortOrder: "updated" as ReviewSortOrder,
  companionServerEnabled: false,
  companionServerToken: null as string | null,
  companionServerPort: 3333,
  companionServerFingerprint: null as string | null,
  companionServerError: null as string | null,
  guideSideNavCollapsed: false,
  guideSideNavWidth: 240,
  matchVscodeTheme: false,
};

export interface PreferencesSlice {
  // UI settings
  codeFontSize: number;
  codeTheme: string;
  uiTheme: string;
  fileToReveal: string | null;
  directoryToReveal: string | null;

  // Diff display settings
  diffLineDiffType: DiffLineDiffType;
  diffIndicators: DiffIndicators;

  // Changes panel display mode (per panel)
  changesDisplayMode: ChangesDisplayMode;
  gitDisplayMode: ChangesDisplayMode;

  // Diff view mode
  diffViewMode: DiffViewMode;

  // Recent repositories
  recentRepositories: RecentRepo[];

  // Crash reporting
  sentryEnabled: boolean;

  // Sound effects
  soundEffectsEnabled: boolean;

  // Tab rail
  tabRailCollapsed: boolean;

  // Files panel (right sidebar)
  filesPanelCollapsed: boolean;

  // Review sort order
  reviewSortOrder: ReviewSortOrder;

  // Companion server
  companionServerEnabled: boolean;
  companionServerToken: string | null;
  companionServerPort: number;
  companionServerFingerprint: string | null;
  companionServerError: string | null;

  // Guide side nav
  guideSideNavCollapsed: boolean;
  guideSideNavWidth: number;

  // VS Code theme matching
  matchVscodeTheme: boolean;
  /** The currently resolved VS Code theme (null when not using VS Code match) */
  resolvedVscodeTheme: UiTheme | null;

  /** True once loadPreferences() has completed (theme, fonts, etc. are ready) */
  preferencesLoaded: boolean;

  // Actions
  setCodeFontSize: (size: number) => void;
  setCodeTheme: (theme: string) => void;
  setUiTheme: (themeId: string) => void;
  setDiffLineDiffType: (type: DiffLineDiffType) => void;
  setDiffIndicators: (indicators: DiffIndicators) => void;
  setChangesDisplayMode: (mode: ChangesDisplayMode) => void;
  setGitDisplayMode: (mode: ChangesDisplayMode) => void;
  setDiffViewMode: (mode: DiffViewMode) => void;
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

  // Tab rail actions
  setTabRailCollapsed: (collapsed: boolean) => void;
  toggleTabRail: () => void;

  // Files panel actions
  setFilesPanelCollapsed: (collapsed: boolean) => void;
  toggleFilesPanel: () => void;

  // Review sort order actions
  setReviewSortOrder: (order: ReviewSortOrder) => void;

  // Companion server actions
  setCompanionServerEnabled: (enabled: boolean) => Promise<void>;
  setCompanionServerToken: (token: string | null) => void;
  setCompanionServerPort: (port: number) => void;
  generateCompanionServerToken: () => Promise<string>;
  regenerateCompanionCertificate: () => Promise<void>;

  // Guide side nav actions
  setGuideSideNavCollapsed: (collapsed: boolean) => void;
  toggleGuideSideNav: () => void;
  setGuideSideNavWidth: (width: number) => void;

  // VS Code theme matching actions
  setMatchVscodeTheme: (enabled: boolean) => Promise<void>;
  detectAndApplyVscodeTheme: () => Promise<void>;
}

export const createPreferencesSlice: SliceCreatorWithStorage<
  PreferencesSlice
> = (storage: StorageService) => (set, get) => {
  /** Log a companion server error and disable the server in both state and storage. */
  function handleCompanionServerError(context: string, error: unknown): void {
    const message = String(error);
    console.error(`${context}:`, message);
    set({ companionServerEnabled: false, companionServerError: message });
    storage.set("companionServerEnabled", false);
  }

  /** Start the companion server on the currently configured port. */
  function startCompanionServer(): Promise<void> {
    return invoke("start_companion_server", {
      port: get().companionServerPort,
    });
  }

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
      applyUiTheme(theme);
    },

    setDiffLineDiffType: (type) => {
      set({ diffLineDiffType: type });
      storage.set("diffLineDiffType", type);
    },

    setDiffIndicators: (indicators) => {
      set({ diffIndicators: indicators });
      storage.set("diffIndicators", indicators);
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

      applyFontSizeCssVariables(loaded.codeFontSize);

      // Apply UI theme (sets all semantic CSS variables + color-scheme)
      if (resolvedVscode) {
        applyResolvedVscodeTheme(resolvedVscode, storage);
      } else {
        applyUiTheme(getUiTheme(loaded.uiTheme));
      }

      // Start companion server if it was previously enabled
      if (loaded.companionServerEnabled) {
        startCompanionServer().catch((e) => {
          handleCompanionServerError(
            "Failed to start companion server on load",
            e,
          );
        });
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

    setReviewSortOrder: (order) => {
      set({ reviewSortOrder: order });
      storage.set("reviewSortOrder", order);
    },

    setCompanionServerEnabled: async (enabled) => {
      set({ companionServerEnabled: enabled, companionServerError: null });
      storage.set("companionServerEnabled", enabled);
      try {
        if (enabled) {
          await startCompanionServer();
          // Fetch fingerprint after server starts (cert is generated on start)
          const fingerprint = await invoke<string | null>(
            "get_companion_fingerprint",
          );
          set({ companionServerFingerprint: fingerprint });
        } else {
          await invoke("stop_companion_server");
        }
      } catch (e) {
        handleCompanionServerError("Failed to toggle companion server", e);
      }
    },

    setCompanionServerToken: (token) => {
      set({ companionServerToken: token });
      storage.set("companionServerToken", token);
    },

    setCompanionServerPort: (port) => {
      set({ companionServerPort: port, companionServerError: null });
      storage.set("companionServerPort", port);
    },

    generateCompanionServerToken: async () => {
      const token = await invoke<string>("generate_companion_token");
      set({ companionServerToken: token });
      storage.set("companionServerToken", token);
      return token;
    },

    regenerateCompanionCertificate: async () => {
      try {
        const fingerprint = await invoke<string>(
          "regenerate_companion_certificate",
        );
        set({
          companionServerFingerprint: fingerprint,
          companionServerError: null,
        });
        // Restart the server if running so it uses the new cert
        if (get().companionServerEnabled) {
          await invoke("stop_companion_server");
          await startCompanionServer();
        }
      } catch (e) {
        handleCompanionServerError("Failed to regenerate certificate", e);
      }
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
        applyUiTheme(theme);
      }
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
  };
};
