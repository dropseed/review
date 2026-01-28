/**
 * Storage utilities for the mobile app.
 *
 * Uses expo-sqlite/localStorage for general key-value storage
 * and expo-secure-store for sensitive data like auth tokens.
 */

// Install localStorage polyfill for expo-sqlite
// After this import, the global localStorage works like web
import "expo-sqlite/localStorage/install";

import * as SecureStore from "expo-secure-store";

/**
 * Secure storage for sensitive data (tokens, credentials).
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Connection settings storage keys.
 */
export const STORAGE_KEYS = {
  SERVER_URL: "compare_server_url",
  AUTH_TOKEN: "compare_auth_token",
  LAST_REPO_ID: "compare_last_repo_id",
} as const;
