import { load, Store } from "@tauri-apps/plugin-store";

// Font size in pixels
export const CODE_FONT_SIZE_DEFAULT = 13;
export const CODE_FONT_SIZE_MIN = 8;
export const CODE_FONT_SIZE_MAX = 32;
export const CODE_FONT_SIZE_STEP = 1;

export interface Preferences {
  sidebarPosition: "left" | "right";
  sidebarWidth: number;
  editorCommand: string | null;
  codeFontSize: number; // pixels
  codeTheme: string;
  autoClassifyEnabled: boolean;
  classifyCommand: string | null;
  classifyBatchSize: number; // hunks per Claude call (1-10)
  classifyMaxConcurrent: number; // max concurrent Claude calls (1-5)
}

const defaults: Preferences = {
  sidebarPosition: "left",
  sidebarWidth: 288,
  editorCommand: null,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  autoClassifyEnabled: true,
  classifyCommand: null,
  classifyBatchSize: 5,
  classifyMaxConcurrent: 2,
};

// Global preferences store (persisted across sessions)
let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("preferences.json", { autoSave: true, defaults: {} });
  }
  return store;
}

export async function getPreference<K extends keyof Preferences>(
  key: K,
): Promise<Preferences[K]> {
  try {
    const s = await getStore();
    const value = await s.get<Preferences[K]>(key);
    return value ?? defaults[key];
  } catch {
    return defaults[key];
  }
}

export async function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Promise<void> {
  try {
    const s = await getStore();
    await s.set(key, value);
  } catch (err) {
    console.error("Failed to save preference:", err);
  }
}

export async function getAllPreferences(): Promise<Preferences> {
  try {
    const s = await getStore();
    return {
      sidebarPosition:
        (await s.get<"left" | "right">("sidebarPosition")) ??
        defaults.sidebarPosition,
      sidebarWidth:
        (await s.get<number>("sidebarWidth")) ?? defaults.sidebarWidth,
      editorCommand:
        (await s.get<string | null>("editorCommand")) ?? defaults.editorCommand,
      codeFontSize:
        (await s.get<number>("codeFontSize")) ?? defaults.codeFontSize,
      codeTheme: (await s.get<string>("codeTheme")) ?? defaults.codeTheme,
      autoClassifyEnabled:
        (await s.get<boolean>("autoClassifyEnabled")) ??
        defaults.autoClassifyEnabled,
      classifyCommand:
        (await s.get<string | null>("classifyCommand")) ??
        defaults.classifyCommand,
      classifyBatchSize:
        (await s.get<number>("classifyBatchSize")) ??
        defaults.classifyBatchSize,
      classifyMaxConcurrent:
        (await s.get<number>("classifyMaxConcurrent")) ??
        defaults.classifyMaxConcurrent,
    };
  } catch {
    return defaults;
  }
}
