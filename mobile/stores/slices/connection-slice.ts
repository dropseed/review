/**
 * Connection Slice
 *
 * Manages connection state for the iOS companion app.
 * Handles server URL, auth token, and connection status.
 */

import type { StateCreator } from "zustand";
import { secureStorage, STORAGE_KEYS } from "@/utils/storage";
import {
  SyncClient,
  createSyncClient,
  type ConnectionStatus,
  type RepoInfo,
  type SyncEvent,
} from "@/api/sync-client";

export interface ConnectionSlice {
  // Connection state
  syncClient: SyncClient | null;
  connectionStatus: ConnectionStatus;
  serverUrl: string;
  authToken: string;
  connectionError: string | null;

  // Repos
  repos: RepoInfo[];
  currentRepoId: string | null;

  // Actions
  loadSettings: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  setAuthToken: (token: string) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  fetchRepos: () => Promise<void>;
  selectRepo: (repoId: string) => void;
}

export const createConnectionSlice: StateCreator<ConnectionSlice> = (
  set,
  get,
) => ({
  // Initial state
  syncClient: null,
  connectionStatus: "disconnected",
  serverUrl: "",
  authToken: "",
  connectionError: null,

  repos: [],
  currentRepoId: null,

  loadSettings: async () => {
    const serverUrl = localStorage.getItem(STORAGE_KEYS.SERVER_URL) || "";
    const authToken = (await secureStorage.get(STORAGE_KEYS.AUTH_TOKEN)) || "";
    const lastRepoId = localStorage.getItem(STORAGE_KEYS.LAST_REPO_ID);

    set({
      serverUrl,
      authToken,
      currentRepoId: lastRepoId,
    });
  },

  setServerUrl: async (url: string) => {
    localStorage.setItem(STORAGE_KEYS.SERVER_URL, url);
    set({ serverUrl: url });
  },

  setAuthToken: async (token: string) => {
    await secureStorage.set(STORAGE_KEYS.AUTH_TOKEN, token);
    set({ authToken: token });
  },

  connect: async () => {
    const { serverUrl, authToken } = get();

    if (!serverUrl || !authToken) {
      set({ connectionError: "Server URL and auth token are required" });
      return;
    }

    set({ connectionStatus: "connecting", connectionError: null });

    const client = createSyncClient({
      serverUrl,
      authToken,
    });

    // Subscribe to status changes
    client.onStatusChange((status) => {
      set({ connectionStatus: status });
    });

    // Subscribe to events
    client.onEvent((event: SyncEvent) => {
      if (event.type === "state_changed") {
        // The sync slice will handle refreshing state
        console.log("[Connection] State changed event:", event);
      }
    });

    try {
      await client.connect();
      set({ syncClient: client, connectionError: null });

      // Fetch repos after connecting
      await get().fetchRepos();
    } catch (error) {
      set({
        syncClient: null,
        connectionStatus: "error",
        connectionError:
          error instanceof Error ? error.message : "Connection failed",
      });
    }
  },

  disconnect: () => {
    const { syncClient } = get();
    if (syncClient) {
      syncClient.disconnect();
    }
    set({
      syncClient: null,
      connectionStatus: "disconnected",
      repos: [],
    });
  },

  fetchRepos: async () => {
    const { syncClient } = get();
    if (!syncClient) return;

    try {
      const repos = await syncClient.listRepos();
      set({ repos });
    } catch (error) {
      console.error("[Connection] Failed to fetch repos:", error);
    }
  },

  selectRepo: (repoId: string) => {
    if (repoId) {
      localStorage.setItem(STORAGE_KEYS.LAST_REPO_ID, repoId);
      set({ currentRepoId: repoId });
    } else {
      localStorage.removeItem(STORAGE_KEYS.LAST_REPO_ID);
      set({ currentRepoId: null });
    }
  },
});
