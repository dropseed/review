import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import type { RecentRepo } from "../../utils/preferences";

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

  // Classification settings
  autoClassifyEnabled: boolean;
  classifyCommand: string | null;
  classifyBatchSize: number;
  classifyMaxConcurrent: number;

  // Recent repositories
  recentRepositories: RecentRepo[];

  // Actions
  setSidebarPosition: (position: "left" | "right") => void;
  setCodeFontSize: (size: number) => void;
  setCodeTheme: (theme: string) => void;
  setDiffLineDiffType: (type: DiffLineDiffType) => void;
  setDiffIndicators: (indicators: DiffIndicators) => void;
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
  addRecentRepository: (path: string) => void;
  removeRecentRepository: (path: string) => void;
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
  autoClassifyEnabled: defaults.autoClassifyEnabled,
  classifyCommand: defaults.classifyCommand,
  classifyBatchSize: defaults.classifyBatchSize,
  classifyMaxConcurrent: defaults.classifyMaxConcurrent,
  recentRepositories: defaults.recentRepositories,

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
    const diffLineDiffType =
      (await storage.get<DiffLineDiffType>("diffLineDiffType")) ??
      defaults.diffLineDiffType;
    const diffIndicators =
      (await storage.get<DiffIndicators>("diffIndicators")) ??
      defaults.diffIndicators;

    set({
      sidebarPosition: position,
      codeFontSize: fontSize,
      codeTheme: theme,
      diffLineDiffType,
      diffIndicators,
      autoClassifyEnabled: autoClassify,
      classifyCommand: classifyCmd,
      classifyBatchSize: batchSize,
      classifyMaxConcurrent: maxConcurrent,
      recentRepositories: recentRepos,
    });

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

  addRecentRepository: (path) => {
    const current = get().recentRepositories;
    // Extract directory name from path
    const name = path.split("/").pop() || path;
    const now = new Date().toISOString();

    // Remove existing entry for this path (to move it to front)
    const filtered = current.filter((r) => r.path !== path);

    // Add to front and limit to MAX_RECENT_REPOS
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
});
