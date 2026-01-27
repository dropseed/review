import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";

// Font size constants
export const CODE_FONT_SIZE_DEFAULT = 12;
export const CODE_FONT_SIZE_MIN = 8;
export const CODE_FONT_SIZE_MAX = 32;
export const CODE_FONT_SIZE_STEP = 1;

// Preference defaults
const defaults = {
  sidebarPosition: "left" as const,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  autoClassifyEnabled: true,
  classifyCommand: null as string | null,
  classifyBatchSize: 5,
  classifyMaxConcurrent: 2,
};

export interface PreferencesSlice {
  // UI settings
  sidebarPosition: "left" | "right";
  codeFontSize: number;
  codeTheme: string;
  fileToReveal: string | null;
  directoryToReveal: string | null;

  // Classification settings
  autoClassifyEnabled: boolean;
  classifyCommand: string | null;
  classifyBatchSize: number;
  classifyMaxConcurrent: number;

  // Actions
  setSidebarPosition: (position: "left" | "right") => void;
  setCodeFontSize: (size: number) => void;
  setCodeTheme: (theme: string) => void;
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
}

export const createPreferencesSlice: SliceCreatorWithStorage<
  PreferencesSlice
> = (storage: StorageService) => (set) => ({
  // Initial state
  sidebarPosition: defaults.sidebarPosition,
  codeFontSize: defaults.codeFontSize,
  codeTheme: defaults.codeTheme,
  fileToReveal: null,
  directoryToReveal: null,
  autoClassifyEnabled: defaults.autoClassifyEnabled,
  classifyCommand: defaults.classifyCommand,
  classifyBatchSize: defaults.classifyBatchSize,
  classifyMaxConcurrent: defaults.classifyMaxConcurrent,

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

    set({
      sidebarPosition: position,
      codeFontSize: fontSize,
      codeTheme: theme,
      autoClassifyEnabled: autoClassify,
      classifyCommand: classifyCmd,
      classifyBatchSize: batchSize,
      classifyMaxConcurrent: maxConcurrent,
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
});
