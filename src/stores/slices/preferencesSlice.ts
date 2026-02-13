import { invoke } from "@tauri-apps/api/core";
import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import type { RecentRepo } from "../../utils/preferences";
import { setSentryConsent } from "../../utils/sentry";
import { setSoundEnabled } from "../../utils/sounds";

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
  reviewSortOrder: "updated" as ReviewSortOrder,
  inactiveReviewSortOrder: "updated" as ReviewSortOrder,
  companionServerEnabled: false,
  companionServerToken: null as string | null,
  companionServerPort: 3333,
  guideSideNavCollapsed: false,
  guideSideNavWidth: 240,
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

  // Review sort order
  reviewSortOrder: ReviewSortOrder;
  inactiveReviewSortOrder: ReviewSortOrder;

  // Companion server
  companionServerEnabled: boolean;
  companionServerToken: string | null;
  companionServerPort: number;

  // Guide side nav
  guideSideNavCollapsed: boolean;
  guideSideNavWidth: number;

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

  // Review sort order actions
  setReviewSortOrder: (order: ReviewSortOrder) => void;
  setInactiveReviewSortOrder: (order: ReviewSortOrder) => void;

  // Companion server actions
  setCompanionServerEnabled: (enabled: boolean) => Promise<void>;
  setCompanionServerToken: (token: string | null) => void;
  setCompanionServerPort: (port: number) => Promise<void>;
  generateCompanionServerToken: () => Promise<string>;

  // Guide side nav actions
  setGuideSideNavCollapsed: (collapsed: boolean) => void;
  toggleGuideSideNav: () => void;
  setGuideSideNavWidth: (width: number) => void;
}

export const createPreferencesSlice: SliceCreatorWithStorage<
  PreferencesSlice
> = (storage: StorageService) => (set, get) => ({
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
  reviewSortOrder: defaults.reviewSortOrder,
  inactiveReviewSortOrder: defaults.inactiveReviewSortOrder,
  companionServerEnabled: defaults.companionServerEnabled,
  companionServerToken: defaults.companionServerToken,
  companionServerPort: defaults.companionServerPort,
  guideSideNavCollapsed: defaults.guideSideNavCollapsed,
  guideSideNavWidth: defaults.guideSideNavWidth,

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
    const [
      rawFontSize,
      rawTheme,
      rawClassifyCmd,
      rawBatchSize,
      rawMaxConcurrent,
      rawRecentRepos,
      rawSentryEnabled,
      rawSoundEffectsEnabled,
      rawTabRailCollapsed,
      rawFilesPanelCollapsed,
      rawReviewSortOrder,
      rawInactiveReviewSortOrder,
      rawCompanionServerEnabled,
      rawCompanionServerToken,
      rawCompanionServerPort,
      rawDiffLineDiffType,
      rawDiffIndicators,
      rawNeedsReviewDisplayMode,
      rawReviewedDisplayMode,
      rawChangesDisplayMode,
      rawDiffViewMode,
      rawGuideSideNavCollapsed,
      rawGuideSideNavWidth,
    ] = await Promise.all([
      storage.get<number>("codeFontSize"),
      storage.get<string>("codeTheme"),
      storage.get<string | null>("classifyCommand"),
      storage.get<number>("classifyBatchSize"),
      storage.get<number>("classifyMaxConcurrent"),
      storage.get<RecentRepo[]>("recentRepositories"),
      storage.get<boolean>("sentryEnabled"),
      storage.get<boolean>("soundEffectsEnabled"),
      storage.get<boolean>("tabRailCollapsed"),
      storage.get<boolean>("filesPanelCollapsed"),
      storage.get<ReviewSortOrder>("reviewSortOrder"),
      storage.get<ReviewSortOrder>("inactiveReviewSortOrder"),
      storage.get<boolean>("companionServerEnabled"),
      storage.get<string | null>("companionServerToken"),
      storage.get<number>("companionServerPort"),
      storage.get<DiffLineDiffType>("diffLineDiffType"),
      storage.get<DiffIndicators>("diffIndicators"),
      storage.get<ChangesDisplayMode>("needsReviewDisplayMode"),
      storage.get<ChangesDisplayMode>("reviewedDisplayMode"),
      storage.get<ChangesDisplayMode>("changesDisplayMode"),
      storage.get<string>("diffViewMode"),
      storage.get<boolean>("guideSideNavCollapsed"),
      storage.get<number>("guideSideNavWidth"),
    ]);

    const fontSize = rawFontSize ?? defaults.codeFontSize;
    const theme = rawTheme ?? defaults.codeTheme;
    const classifyCmd = rawClassifyCmd ?? defaults.classifyCommand;
    const batchSize = rawBatchSize ?? defaults.classifyBatchSize;
    const maxConcurrent = rawMaxConcurrent ?? defaults.classifyMaxConcurrent;
    const recentRepos = rawRecentRepos ?? defaults.recentRepositories;
    const sentryEnabled = rawSentryEnabled ?? defaults.sentryEnabled;
    const soundEffectsEnabled =
      rawSoundEffectsEnabled ?? defaults.soundEffectsEnabled;
    const tabRailCollapsed = rawTabRailCollapsed ?? defaults.tabRailCollapsed;
    const filesPanelCollapsed =
      rawFilesPanelCollapsed ?? defaults.filesPanelCollapsed;
    const reviewSortOrder = rawReviewSortOrder ?? defaults.reviewSortOrder;
    const inactiveReviewSortOrder =
      rawInactiveReviewSortOrder ?? defaults.inactiveReviewSortOrder;
    const companionServerEnabled =
      rawCompanionServerEnabled ?? defaults.companionServerEnabled;
    const companionServerToken =
      rawCompanionServerToken ?? defaults.companionServerToken;
    const companionServerPort =
      rawCompanionServerPort ?? defaults.companionServerPort;
    const diffLineDiffType = rawDiffLineDiffType ?? defaults.diffLineDiffType;
    const diffIndicators = rawDiffIndicators ?? defaults.diffIndicators;
    // Migrate from the old single "changesDisplayMode" key
    const needsReviewDisplayMode =
      rawNeedsReviewDisplayMode ??
      rawChangesDisplayMode ??
      defaults.needsReviewDisplayMode;
    const reviewedDisplayMode =
      rawReviewedDisplayMode ??
      rawChangesDisplayMode ??
      defaults.reviewedDisplayMode;
    let diffViewMode: DiffViewMode =
      (rawDiffViewMode as DiffViewMode) ?? defaults.diffViewMode;
    // Migrate legacy "file" mode to "new"
    if ((diffViewMode as string) === "file") diffViewMode = "new";
    const guideSideNavCollapsed =
      rawGuideSideNavCollapsed ?? defaults.guideSideNavCollapsed;
    const guideSideNavWidth =
      rawGuideSideNavWidth ?? defaults.guideSideNavWidth;

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
      reviewSortOrder,
      inactiveReviewSortOrder,
      companionServerEnabled,
      companionServerToken,
      companionServerPort,
      guideSideNavCollapsed,
      guideSideNavWidth,
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

    // Start companion server if it was previously enabled
    if (companionServerEnabled) {
      invoke("start_companion_server").catch((e) => {
        console.error("Failed to start companion server on load:", e);
      });
    }
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

  setReviewSortOrder: (order) => {
    set({ reviewSortOrder: order });
    storage.set("reviewSortOrder", order);
  },

  setInactiveReviewSortOrder: (order) => {
    set({ inactiveReviewSortOrder: order });
    storage.set("inactiveReviewSortOrder", order);
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

  setCompanionServerPort: async (port) => {
    set({ companionServerPort: port });
    storage.set("companionServerPort", port);
    // Restart the server if it's currently running so the new port takes effect
    if (get().companionServerEnabled) {
      try {
        await invoke("stop_companion_server");
        await invoke("start_companion_server");
      } catch (e) {
        console.error("Failed to restart companion server with new port:", e);
      }
    }
  },

  generateCompanionServerToken: async () => {
    const token = await invoke<string>("generate_companion_token");
    set({ companionServerToken: token });
    storage.set("companionServerToken", token);
    return token;
  },

  setGuideSideNavCollapsed: (collapsed) => {
    set({ guideSideNavCollapsed: collapsed });
    storage.set("guideSideNavCollapsed", collapsed);
  },

  toggleGuideSideNav: () => {
    const collapsed = !get().guideSideNavCollapsed;
    set({ guideSideNavCollapsed: collapsed });
    storage.set("guideSideNavCollapsed", collapsed);
  },

  setGuideSideNavWidth: (width) => {
    set({ guideSideNavWidth: width });
    storage.set("guideSideNavWidth", width);
  },
});
