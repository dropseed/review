import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { ApiClient } from "../api/client";
import type { ServerInfo } from "../api/types";

const STORAGE_KEY_URL = "review_server_url";
const STORAGE_KEY_TOKEN = "review_auth_token";

interface ConnectionState {
  serverUrl: string;
  authToken: string;
  isConnected: boolean;
  serverInfo: ServerInfo | null;
  isLoading: boolean;
  error: string | null;

  loadSaved: () => Promise<void>;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  checkConnection: () => Promise<boolean>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  serverUrl: "",
  authToken: "",
  isConnected: false,
  serverInfo: null,
  isLoading: false,
  error: null,

  loadSaved: async () => {
    try {
      const url = await SecureStore.getItemAsync(STORAGE_KEY_URL);
      const token = await SecureStore.getItemAsync(STORAGE_KEY_TOKEN);
      if (url && token) {
        set({ serverUrl: url, authToken: token });
        // Try to reconnect silently
        const client = new ApiClient(url, token);
        try {
          await client.getHealth();
          const info = await client.getInfo();
          set({ isConnected: true, serverInfo: info });
        } catch {
          // Saved credentials exist but server is unreachable
          set({ isConnected: false });
        }
      }
    } catch {
      // SecureStore not available (e.g., in development)
    }
  },

  connect: async (url: string, token: string) => {
    set({ isLoading: true, error: null });
    try {
      const client = new ApiClient(url, token);
      await client.getHealth();
      const info = await client.getInfo();

      await SecureStore.setItemAsync(STORAGE_KEY_URL, url);
      await SecureStore.setItemAsync(STORAGE_KEY_TOKEN, token);

      set({
        serverUrl: url,
        authToken: token,
        isConnected: true,
        serverInfo: info,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : "Failed to connect to server",
      });
      throw err;
    }
  },

  disconnect: async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY_URL);
    await SecureStore.deleteItemAsync(STORAGE_KEY_TOKEN);
    set({
      serverUrl: "",
      authToken: "",
      isConnected: false,
      serverInfo: null,
      error: null,
    });
  },

  checkConnection: async () => {
    const { serverUrl, authToken } = get();
    if (!serverUrl || !authToken) return false;
    try {
      const client = new ApiClient(serverUrl, authToken);
      await client.getHealth();
      const info = await client.getInfo();
      set({ isConnected: true, serverInfo: info });
      return true;
    } catch {
      set({ isConnected: false });
      return false;
    }
  },
}));
