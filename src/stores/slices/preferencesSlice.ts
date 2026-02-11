import { invoke } from "@tauri-apps/api/core";
import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import type { RecentRepo } from "../../utils/preferences";
import { setSentryConsent } from "../../utils/sentry";
import { setSoundEnabled } from "../../utils/sounds";

// Font size constants
export const CODE_FONT_SIZE_DEFAULT = 11;
export const CODE_FONT_SIZE_MIN = 8;
export const CODE_FONT_SIZE_MAX = 32;
export const CODE_FONT_SIZE_STEP = 1;

// Max number of recent repositories to keep
const MAX_RECENT_REPOS = 5;

// Diff display option types
export type DiffLineDiffType = "word" | "word-alt" | "char" | "none";
export type DiffIndicators = "classic" | "bars" | "none";

// Changes display mode type
export type ChangesDisplayMode = "tree" | "flat";

// Diff view mode type
export type DiffViewMode = "unified" | "split" | "old" | "new";

// Review sort order type
export type ReviewSortOrder = "updated" | "repo" | "size";

// Preference defaults
const defaults = {
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  classifyCommand: null as string | null,
  classifyBatchSize: 5,
  classifyMaxConcurrent: 2,
  recentRepositories: [] as RecentRepo[],
  diffLineDiffType: "word" as DiffLineDiffType,
  diffIndicators: "bars" as DiffIndicators,
  needsReviewDisplayMode: "tree" as ChangesDisplayMode,
  reviewedDisplayMode: "tree" as ChangesDisplayMode,
  diffViewMode: "split" as DiffViewMode,
  sentryEnabled: false,
  soundEffectsEnabled: true,
  tabRailCollapsed: false,
  filesPanelCollapsed: false,
  pinnedReviewKeys: [] as string[],
  reviewSortOrder: "updated" as ReviewSortOrder,
  companionServerEnabled: false,
  companionServerToken: null as string | null,
};

export interface PreferencesSlice {
  // UI settings
  codeFontSize: number;
  codeTheme: string;
  fileToReveal: string | null;
  directoryToReveal: string | null;

  // Diff display settings
  diffLineDiffType: DiffLineDiffType;
  diffIndicators: DiffIndicators;

  // Changes panel display mode (per section)
  needsReviewDisplayMode: ChangesDisplayMode;
  reviewedDisplayMode: ChangesDisplayMode;

  // Diff view mode
  diffViewMode: DiffViewMode;

  // Classification settings
  classifyCommand: string | null;
  classifyBatchSize: number;
  classifyMaxConcurrent: number;

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

  // Pinned reviews (ordered array of "repoPath:comparisonKey" strings)
  pinnedReviewKeys: string[];

  // Review sort order
  reviewSortOrder: ReviewSortOrder;

  // Companion server
  companionServerEnabled: boolean;
  companionServerToken: string | null;

  // Actions
  setCodeFontSize: (size: number) => void;
  setCodeTheme: (theme: string) => void;
  setDiffLineDiffType: (type: DiffLineDiffType) => void;
  setDiffIndicators: (indicators: DiffIndicators) => void;
  setNeedsReviewDisplayMode: (mode: ChangesDisplayMode) => void;
  setReviewedDisplayMode: (mode: ChangesDisplayMode) => void;
  setDiffViewMode: (mode: DiffViewMode) => void;
  loadPreferences: () => Promise<void>;
  revealFileInTree: (path: string) => void;
  clearFileToReveal: () => void;
  revealDirectoryInTree: (path: string) => void;
  clearDirectoryToReveal: () => void;

  // Classification settings actions
  setClassifyCommand: (command: string | null) => void;
  setClassifyBatchSize: (size: number) => void;
  setClassifyMaxConcurrent: (count: number) => void;

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

  // Pinned reviews actions
  pinReview: (key: string) => void;
  unpinReview: (key: string) => void;
  reorderPinnedReviews: (keys: string[]) => void;

  // Review sort order actions
  setReviewSortOrder: (order: ReviewSortOrder) => void;

  // Companion server actions
  setCompanionServerEnabled: (enabled: boolean) => Promise<void>;
  setCompanionServerToken: (token: string | null) => void;
  generateCompanionServerToken: () => Promise<string>;
}

export const createPreferencesSlice: SliceCreatorWithStorage<
  PreferencesSlice
> = (storage: StorageService) => (set, get) => ({
  // Initial state
  codeFontSize: defaults.codeFontSize,
  codeTheme: defaults.codeTheme,
  fileToReveal: null,
  directoryToReveal: null,
  diffLineDiffType: defaults.diffLineDiffType,
  diffIndicators: defaults.diffIndicators,
  needsReviewDisplayMode: defaults.needsReviewDisplayMode,
  reviewedDisplayMode: defaults.reviewedDisplayMode,
  diffViewMode: defaults.diffViewMode,
  classifyCommand: defaults.classifyCommand,
  classifyBatchSize: defaults.classifyBatchSize,
  classifyMaxConcurrent: defaults.classifyMaxConcurrent,
  recentRepositories: defaults.recentRepositories,
  sentryEnabled: defaults.sentryEnabled,
  soundEffectsEnabled: defaults.soundEffectsEnabled,
  tabRailCollapsed: defaults.tabRailCollapsed,
  filesPanelCollapsed: defaults.filesPanelCollapsed,
  pinnedReviewKeys: defaults.pinnedReviewKeys,
  reviewSortOrder: defaults.reviewSortOrder,
  companionServerEnabled: defaults.companionServerEnabled,
  companionServerToken: defaults.companionServerToken,

  setCodeFontSize: (size) => {
    set({ codeFontSize: size });
    storage.set("codeFontSize", size);
    // Update CSS variables for global font size and UI scale
    document.documentElement.style.setProperty("--code-font-size", `${size}px`);
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(size / CODE_FONT_SIZE_DEFAULT),
    );
  },

  setCodeTheme: (theme) => {
    set({ codeTheme: theme });
    storage.set("codeTheme", theme);
  },

  setDiffLineDiffType: (type) => {
    set({ diffLineDiffType: type });
    storage.set("diffLineDiffType", type);
  },

  setDiffIndicators: (indicators) => {
    set({ diffIndicators: indicators });
    storage.set("diffIndicators", indicators);
  },

  setNeedsReviewDisplayMode: (mode) => {
    set({ needsReviewDisplayMode: mode });
    storage.set("needsReviewDisplayMode", mode);
  },

  setReviewedDisplayMode: (mode) => {
    set({ reviewedDisplayMode: mode });
    storage.set("reviewedDisplayMode", mode);
  },

  setDiffViewMode: (mode) => {
    set({ diffViewMode: mode });
    storage.set("diffViewMode", mode);
  },

  loadPreferences: async () => {
    const fontSize =
      (await storage.get<number>("codeFontSize")) ?? defaults.codeFontSize;
    const theme =
      (await storage.get<string>("codeTheme")) ?? defaults.codeTheme;
    const classifyCmd =
      (await storage.get<string | null>("classifyCommand")) ??
      defaults.classifyCommand;
    const batchSize =
      (await storage.get<number>("classifyBatchSize")) ??
      defaults.classifyBatchSize;
    const maxConcurrent =
      (await storage.get<number>("classifyMaxConcurrent")) ??
      defaults.classifyMaxConcurrent;
    const recentRepos =
      (await storage.get<RecentRepo[]>("recentRepositories")) ??
      defaults.recentRepositories;
    const sentryEnabled =
      (await storage.get<boolean>("sentryEnabled")) ?? defaults.sentryEnabled;
    const soundEffectsEnabled =
      (await storage.get<boolean>("soundEffectsEnabled")) ??
      defaults.soundEffectsEnabled;
    const tabRailCollapsed =
      (await storage.get<boolean>("tabRailCollapsed")) ??
      defaults.tabRailCollapsed;
    const filesPanelCollapsed =
      (await storage.get<boolean>("filesPanelCollapsed")) ??
      defaults.filesPanelCollapsed;
    const pinnedReviewKeys =
      (await storage.get<string[]>("pinnedReviewKeys")) ??
      defaults.pinnedReviewKeys;
    const reviewSortOrder =
      (await storage.get<ReviewSortOrder>("reviewSortOrder")) ??
      defaults.reviewSortOrder;
    const companionServerEnabled =
      (await storage.get<boolean>("companionServerEnabled")) ??
      defaults.companionServerEnabled;
    const companionServerToken =
      (await storage.get<string | null>("companionServerToken")) ??
      defaults.companionServerToken;
    const diffLineDiffType =
      (await storage.get<DiffLineDiffType>("diffLineDiffType")) ??
      defaults.diffLineDiffType;
    const diffIndicators =
      (await storage.get<DiffIndicators>("diffIndicators")) ??
      defaults.diffIndicators;
    const needsReviewDisplayMode =
      (await storage.get<ChangesDisplayMode>("needsReviewDisplayMode")) ??
      // Migrate from the old single key
      (await storage.get<ChangesDisplayMode>("changesDisplayMode")) ??
      defaults.needsReviewDisplayMode;
    const reviewedDisplayMode =
      (await storage.get<ChangesDisplayMode>("reviewedDisplayMode")) ??
      (await storage.get<ChangesDisplayMode>("changesDisplayMode")) ??
      defaults.reviewedDisplayMode;
    let diffViewMode: DiffViewMode =
      ((await storage.get<string>("diffViewMode")) as DiffViewMode) ??
      defaults.diffViewMode;
    // Migrate legacy "file" mode to "new"
    if ((diffViewMode as string) === "file") diffViewMode = "new";

    set({
      codeFontSize: fontSize,
      codeTheme: theme,
      diffLineDiffType,
      diffIndicators,
      needsReviewDisplayMode,
      reviewedDisplayMode,
      diffViewMode,
      classifyCommand: classifyCmd,
      classifyBatchSize: batchSize,
      classifyMaxConcurrent: maxConcurrent,
      recentRepositories: recentRepos,
      sentryEnabled,
      soundEffectsEnabled,
      tabRailCollapsed,
      filesPanelCollapsed,
      pinnedReviewKeys,
      reviewSortOrder,
      companionServerEnabled,
      companionServerToken,
    });

    // Propagate Sentry consent to both JS and Rust SDKs
    setSentryConsent(sentryEnabled);
    invoke("set_sentry_consent", { enabled: sentryEnabled }).catch(() => {});

    // Propagate sound setting
    setSoundEnabled(soundEffectsEnabled);

    // Apply font size CSS variables
    document.documentElement.style.setProperty(
      "--code-font-size",
      `${fontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(fontSize / CODE_FONT_SIZE_DEFAULT),
    );
  },

  revealFileInTree: (path) => {
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

  setClassifyCommand: (command) => {
    set({ classifyCommand: command });
    storage.set("classifyCommand", command);
  },

  setClassifyBatchSize: (size) => {
    set({ classifyBatchSize: size });
    storage.set("classifyBatchSize", size);
  },

  setClassifyMaxConcurrent: (count) => {
    set({ classifyMaxConcurrent: count });
    storage.set("classifyMaxConcurrent", count);
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
    const collapsed = !get().tabRailCollapsed;
    set({ tabRailCollapsed: collapsed });
    storage.set("tabRailCollapsed", collapsed);
  },

  setFilesPanelCollapsed: (collapsed) => {
    set({ filesPanelCollapsed: collapsed });
    storage.set("filesPanelCollapsed", collapsed);
  },

  toggleFilesPanel: () => {
    const collapsed = !get().filesPanelCollapsed;
    set({ filesPanelCollapsed: collapsed });
    storage.set("filesPanelCollapsed", collapsed);
  },

  pinReview: (key) => {
    const current = get().pinnedReviewKeys;
    if (current.includes(key)) return;
    const updated = [...current, key];
    set({ pinnedReviewKeys: updated });
    storage.set("pinnedReviewKeys", updated);
  },

  unpinReview: (key) => {
    const current = get().pinnedReviewKeys;
    const updated = current.filter((k) => k !== key);
    set({ pinnedReviewKeys: updated });
    storage.set("pinnedReviewKeys", updated);
  },

  reorderPinnedReviews: (keys) => {
    set({ pinnedReviewKeys: keys });
    storage.set("pinnedReviewKeys", keys);
  },

  setReviewSortOrder: (order) => {
    set({ reviewSortOrder: order });
    storage.set("reviewSortOrder", order);
  },

  setCompanionServerEnabled: async (enabled) => {
    set({ companionServerEnabled: enabled });
    storage.set("companionServerEnabled", enabled);
    try {
      if (enabled) {
        await invoke("start_companion_server");
      } else {
        await invoke("stop_companion_server");
      }
    } catch (e) {
      console.error("Failed to toggle companion server:", e);
    }
  },

  setCompanionServerToken: (token) => {
    set({ companionServerToken: token });
    storage.set("companionServerToken", token);
  },

  generateCompanionServerToken: async () => {
    const token = await invoke<string>("generate_companion_token");
    set({ companionServerToken: token });
    storage.set("companionServerToken", token);
    return token;
  },
});
