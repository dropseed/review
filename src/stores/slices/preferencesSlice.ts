import { invoke } from "@tauri-apps/api/core";
import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import type { RecentRepo } from "../../utils/preferences";
import { setSentryConsent } from "../../utils/sentry";

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

// Preference defaults
const defaults = {
  sidebarPosition: "left" as const,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  autoClassifyEnabled: true,
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
};

export interface PreferencesSlice {
  // UI settings
  sidebarPosition: "left" | "right";
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
  autoClassifyEnabled: boolean;
  classifyCommand: string | null;
  classifyBatchSize: number;
  classifyMaxConcurrent: number;

  // Recent repositories
  recentRepositories: RecentRepo[];

  // Crash reporting
  sentryEnabled: boolean;

  // Actions
  setSidebarPosition: (position: "left" | "right") => void;
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
  setAutoClassifyEnabled: (enabled: boolean) => void;
  setClassifyCommand: (command: string | null) => void;
  setClassifyBatchSize: (size: number) => void;
  setClassifyMaxConcurrent: (count: number) => void;

  // Recent repositories actions
  addRecentRepository: (path: string) => Promise<void>;
  removeRecentRepository: (path: string) => void;

  // Crash reporting actions
  setSentryEnabled: (enabled: boolean) => void;
}

export const createPreferencesSlice: SliceCreatorWithStorage<
  PreferencesSlice
> = (storage: StorageService) => (set, get) => ({
  // Initial state
  sidebarPosition: defaults.sidebarPosition,
  codeFontSize: defaults.codeFontSize,
  codeTheme: defaults.codeTheme,
  fileToReveal: null,
  directoryToReveal: null,
  diffLineDiffType: defaults.diffLineDiffType,
  diffIndicators: defaults.diffIndicators,
  needsReviewDisplayMode: defaults.needsReviewDisplayMode,
  reviewedDisplayMode: defaults.reviewedDisplayMode,
  diffViewMode: defaults.diffViewMode,
  autoClassifyEnabled: defaults.autoClassifyEnabled,
  classifyCommand: defaults.classifyCommand,
  classifyBatchSize: defaults.classifyBatchSize,
  classifyMaxConcurrent: defaults.classifyMaxConcurrent,
  recentRepositories: defaults.recentRepositories,
  sentryEnabled: defaults.sentryEnabled,

  setSidebarPosition: (position) => {
    set({ sidebarPosition: position });
    storage.set("sidebarPosition", position);
  },

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
    const position =
      (await storage.get<"left" | "right">("sidebarPosition")) ??
      defaults.sidebarPosition;
    const fontSize =
      (await storage.get<number>("codeFontSize")) ?? defaults.codeFontSize;
    const theme =
      (await storage.get<string>("codeTheme")) ?? defaults.codeTheme;
    const autoClassify =
      (await storage.get<boolean>("autoClassifyEnabled")) ??
      defaults.autoClassifyEnabled;
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
      sidebarPosition: position,
      codeFontSize: fontSize,
      codeTheme: theme,
      diffLineDiffType,
      diffIndicators,
      needsReviewDisplayMode,
      reviewedDisplayMode,
      diffViewMode,
      autoClassifyEnabled: autoClassify,
      classifyCommand: classifyCmd,
      classifyBatchSize: batchSize,
      classifyMaxConcurrent: maxConcurrent,
      recentRepositories: recentRepos,
      sentryEnabled,
    });

    // Propagate Sentry consent to both JS and Rust SDKs
    setSentryConsent(sentryEnabled);
    invoke("set_sentry_consent", { enabled: sentryEnabled }).catch(() => {});

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

  setAutoClassifyEnabled: (enabled) => {
    set({ autoClassifyEnabled: enabled });
    storage.set("autoClassifyEnabled", enabled);
    if (enabled) {
      get().triggerAutoClassification();
    }
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
});
