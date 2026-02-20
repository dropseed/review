/**
 * Preferences utilities
 *
 * This module provides backward-compatible access to preferences.
 * New code should use the platform storage service directly.
 */

import { getPlatformServices } from "../platform";

// Re-export font size constants from preferencesSlice
export {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../stores/slices/preferencesSlice";

export interface RecentRepo {
  path: string;
  name: string; // directory name for display
  lastOpened: string; // ISO date
}

export interface Preferences {
  sidebarWidth: number;
  editorCommand: string | null;
  codeFontSize: number; // pixels
  codeTheme: string;
  recentRepositories: RecentRepo[];
}

const defaults: Preferences = {
  sidebarWidth: 288,
  editorCommand: null,
  codeFontSize: 12, // matches CODE_FONT_SIZE_DEFAULT
  codeTheme: "github-dark",
  recentRepositories: [],
};

/**
 * Get a preference value.
 * Uses the platform storage service.
 */
export async function getPreference<K extends keyof Preferences>(
  key: K,
): Promise<Preferences[K]> {
  try {
    const storage = getPlatformServices().storage;
    const value = await storage.get<Preferences[K]>(key);
    return value ?? defaults[key];
  } catch {
    return defaults[key];
  }
}

/**
 * Set a preference value.
 * Uses the platform storage service.
 */
export async function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Promise<void> {
  try {
    const storage = getPlatformServices().storage;
    await storage.set(key, value);
  } catch (err) {
    console.error("Failed to save preference:", err);
  }
}

/**
 * Get all preferences.
 */
export async function getAllPreferences(): Promise<Preferences> {
  const storage = getPlatformServices().storage;
  try {
    return {
      sidebarWidth:
        (await storage.get<number>("sidebarWidth")) ?? defaults.sidebarWidth,
      editorCommand:
        (await storage.get<string | null>("editorCommand")) ??
        defaults.editorCommand,
      codeFontSize:
        (await storage.get<number>("codeFontSize")) ?? defaults.codeFontSize,
      codeTheme: (await storage.get<string>("codeTheme")) ?? defaults.codeTheme,
      recentRepositories:
        (await storage.get<RecentRepo[]>("recentRepositories")) ??
        defaults.recentRepositories,
    };
  } catch {
    return defaults;
  }
}
