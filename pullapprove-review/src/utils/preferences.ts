import { load, Store } from "@tauri-apps/plugin-store";

export interface Preferences {
  sidebarPosition: "left" | "right";
  sidebarWidth: number;
  editorCommand: string | null;
}

const defaults: Preferences = {
  sidebarPosition: "left",
  sidebarWidth: 288,
  editorCommand: null,
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
  key: K
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
  value: Preferences[K]
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
      sidebarPosition: (await s.get<"left" | "right">("sidebarPosition")) ?? defaults.sidebarPosition,
      sidebarWidth: (await s.get<number>("sidebarWidth")) ?? defaults.sidebarWidth,
      editorCommand: (await s.get<string | null>("editorCommand")) ?? defaults.editorCommand,
    };
  } catch {
    return defaults;
  }
}
