/**
 * Sync Slice
 *
 * Manages sync server state for iOS companion app connectivity.
 */

import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";
import {
  startSyncServer,
  stopSyncServer,
  getSyncServerStatus,
  generateSyncAuthToken,
  DEFAULT_SYNC_PORT,
} from "../../api/sync-server";
import { listen } from "@tauri-apps/api/event";

export interface SyncSlice {
  // State
  syncServerEnabled: boolean;
  syncServerPort: number;
  syncAuthToken: string | null;
  syncServerRunning: boolean;
  syncTailscaleIp: string | null;
  syncConnectedClients: number;
  syncError: string | null;

  // Actions
  loadSyncSettings: () => Promise<void>;
  setSyncServerEnabled: (enabled: boolean) => Promise<void>;
  setSyncServerPort: (port: number) => void;
  regenerateAuthToken: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
}

const defaults = {
  syncServerEnabled: false,
  syncServerPort: DEFAULT_SYNC_PORT,
  syncAuthToken: null as string | null,
};

export const createSyncSlice: SliceCreatorWithStorage<SyncSlice> =
  (storage: StorageService) => (set, get) => ({
    // Initial state
    syncServerEnabled: defaults.syncServerEnabled,
    syncServerPort: defaults.syncServerPort,
    syncAuthToken: defaults.syncAuthToken,
    syncServerRunning: false,
    syncTailscaleIp: null,
    syncConnectedClients: 0,
    syncError: null,

    loadSyncSettings: async () => {
      const enabled =
        (await storage.get<boolean>("syncServerEnabled")) ??
        defaults.syncServerEnabled;
      const port =
        (await storage.get<number>("syncServerPort")) ??
        defaults.syncServerPort;
      let token =
        (await storage.get<string | null>("syncAuthToken")) ??
        defaults.syncAuthToken;

      // Generate token if not set
      if (!token) {
        try {
          token = await generateSyncAuthToken();
          await storage.set("syncAuthToken", token);
        } catch {
          // Not in Tauri environment, ignore
        }
      }

      set({
        syncServerEnabled: enabled,
        syncServerPort: port,
        syncAuthToken: token,
      });

      // Get current server status
      try {
        const status = await getSyncServerStatus();
        set({
          syncServerRunning: status.running,
          syncTailscaleIp: status.tailscaleIp,
          syncConnectedClients: status.clientCount,
        });

        // Auto-start if enabled and not running
        if (enabled && !status.running && token) {
          try {
            const newStatus = await startSyncServer(port, token);
            set({
              syncServerRunning: newStatus.running,
              syncTailscaleIp: newStatus.tailscaleIp,
              syncConnectedClients: newStatus.clientCount,
              syncError: null,
            });
          } catch (err) {
            set({
              syncError:
                err instanceof Error ? err.message : "Failed to start server",
            });
          }
        }

        // Listen for tray menu events
        listen("tray:start-server", async () => {
          const { syncServerPort, syncAuthToken, syncServerRunning } = get();
          if (syncServerRunning || !syncAuthToken) return;
          try {
            const newStatus = await startSyncServer(
              syncServerPort,
              syncAuthToken,
            );
            set({
              syncServerEnabled: true,
              syncServerRunning: newStatus.running,
              syncTailscaleIp: newStatus.tailscaleIp,
              syncConnectedClients: newStatus.clientCount,
              syncError: null,
            });
            await storage.set("syncServerEnabled", true);
          } catch (err) {
            set({
              syncError:
                err instanceof Error ? err.message : "Failed to start server",
            });
          }
        });

        listen("tray:stop-server", async () => {
          const { syncServerRunning } = get();
          if (!syncServerRunning) return;
          try {
            await stopSyncServer();
            set({
              syncServerEnabled: false,
              syncServerRunning: false,
              syncConnectedClients: 0,
              syncError: null,
            });
            await storage.set("syncServerEnabled", false);
          } catch (err) {
            set({
              syncError:
                err instanceof Error ? err.message : "Failed to stop server",
            });
          }
        });
      } catch {
        // Not in Tauri environment
      }
    },

    setSyncServerEnabled: async (enabled: boolean) => {
      const { syncServerPort, syncAuthToken } = get();

      set({ syncServerEnabled: enabled });
      await storage.set("syncServerEnabled", enabled);

      if (enabled) {
        if (!syncAuthToken) {
          set({ syncError: "No auth token configured" });
          return;
        }
        try {
          const status = await startSyncServer(syncServerPort, syncAuthToken);
          set({
            syncServerRunning: status.running,
            syncTailscaleIp: status.tailscaleIp,
            syncConnectedClients: status.clientCount,
            syncError: null,
          });
        } catch (err) {
          set({
            syncServerRunning: false,
            syncError:
              err instanceof Error ? err.message : "Failed to start server",
          });
        }
      } else {
        try {
          await stopSyncServer();
          set({
            syncServerRunning: false,
            syncConnectedClients: 0,
            syncError: null,
          });
        } catch (err) {
          set({
            syncError:
              err instanceof Error ? err.message : "Failed to stop server",
          });
        }
      }
    },

    setSyncServerPort: (port: number) => {
      set({ syncServerPort: port });
      storage.set("syncServerPort", port);
    },

    regenerateAuthToken: async () => {
      try {
        const token = await generateSyncAuthToken();
        set({ syncAuthToken: token });
        await storage.set("syncAuthToken", token);

        // If server is running, restart it with new token
        const { syncServerEnabled, syncServerPort } = get();
        if (syncServerEnabled) {
          await stopSyncServer();
          const status = await startSyncServer(syncServerPort, token);
          set({
            syncServerRunning: status.running,
            syncTailscaleIp: status.tailscaleIp,
            syncConnectedClients: status.clientCount,
            syncError: null,
          });
        }
      } catch (err) {
        set({
          syncError:
            err instanceof Error
              ? err.message
              : "Failed to regenerate auth token",
        });
      }
    },

    refreshSyncStatus: async () => {
      try {
        const status = await getSyncServerStatus();
        set({
          syncServerRunning: status.running,
          syncTailscaleIp: status.tailscaleIp,
          syncConnectedClients: status.clientCount,
        });
      } catch {
        // Not in Tauri environment
      }
    },
  });
