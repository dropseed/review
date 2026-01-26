import type { SliceCreator } from "../types";
import {
  getPreference,
  setPreference,
  CODE_FONT_SIZE_DEFAULT,
} from "../../utils/preferences";

export interface PreferencesSlice {
  // UI settings
  sidebarPosition: "left" | "right";
  codeFontSize: number;
  codeTheme: string;
  fileToReveal: string | null;

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

  // Classification settings actions
  setAutoClassifyEnabled: (enabled: boolean) => void;
  setClassifyCommand: (command: string | null) => void;
  setClassifyBatchSize: (size: number) => void;
  setClassifyMaxConcurrent: (count: number) => void;
}

export const createPreferencesSlice: SliceCreator<PreferencesSlice> = (
  set,
) => ({
  // Initial state
  sidebarPosition: "left",
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  fileToReveal: null,
  autoClassifyEnabled: true,
  classifyCommand: null,
  classifyBatchSize: 5,
  classifyMaxConcurrent: 2,

  setSidebarPosition: (position) => {
    set({ sidebarPosition: position });
    setPreference("sidebarPosition", position);
  },

  setCodeFontSize: (size) => {
    set({ codeFontSize: size });
    setPreference("codeFontSize", size);
    // Update CSS variables for global font size and UI scale
    document.documentElement.style.setProperty("--code-font-size", `${size}px`);
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(size / CODE_FONT_SIZE_DEFAULT),
    );
  },

  setCodeTheme: (theme) => {
    set({ codeTheme: theme });
    setPreference("codeTheme", theme);
  },

  loadPreferences: async () => {
    const position = await getPreference("sidebarPosition");
    const fontSize = await getPreference("codeFontSize");
    const theme = await getPreference("codeTheme");
    const autoClassify = await getPreference("autoClassifyEnabled");
    const classifyCmd = await getPreference("classifyCommand");
    const batchSize = await getPreference("classifyBatchSize");
    const maxConcurrent = await getPreference("classifyMaxConcurrent");

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

  setAutoClassifyEnabled: (enabled) => {
    set({ autoClassifyEnabled: enabled });
    setPreference("autoClassifyEnabled", enabled);
  },

  setClassifyCommand: (command) => {
    set({ classifyCommand: command });
    setPreference("classifyCommand", command);
  },

  setClassifyBatchSize: (size) => {
    set({ classifyBatchSize: size });
    setPreference("classifyBatchSize", size);
  },

  setClassifyMaxConcurrent: (count) => {
    set({ classifyMaxConcurrent: count });
    setPreference("classifyMaxConcurrent", count);
  },
});
