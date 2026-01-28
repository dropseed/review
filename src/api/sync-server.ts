/**
 * Sync Server API
 *
 * Functions for controlling the sync server (iOS companion app connectivity).
 * Only available in the Tauri desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "./client";

export interface SyncServerStatus {
  running: boolean;
  port: number;
  tailscaleIp: string | null;
  clientCount: number;
}

/**
 * Start the sync server for iOS companion app connectivity.
 */
export async function startSyncServer(
  port: number | null,
  authToken: string,
): Promise<SyncServerStatus> {
  if (!isTauriEnvironment()) {
    throw new Error("Sync server is only available in desktop app");
  }
  return invoke<SyncServerStatus>("start_sync_server", { port, authToken });
}

/**
 * Stop the sync server.
 */
export async function stopSyncServer(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  await invoke("stop_sync_server");
}

/**
 * Get the current sync server status.
 */
export async function getSyncServerStatus(): Promise<SyncServerStatus> {
  if (!isTauriEnvironment()) {
    return { running: false, port: 17950, tailscaleIp: null, clientCount: 0 };
  }
  return invoke<SyncServerStatus>("get_sync_server_status");
}

/**
 * Generate a new auth token for the sync server.
 */
export async function generateSyncAuthToken(): Promise<string> {
  if (!isTauriEnvironment()) {
    throw new Error("Auth token generation is only available in desktop app");
  }
  return invoke<string>("generate_sync_auth_token");
}

/**
 * Default sync server port.
 */
export const DEFAULT_SYNC_PORT = 17950;
