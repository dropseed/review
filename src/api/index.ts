/**
 * API Layer
 *
 * Provides a unified interface for backend operations that can be
 * implemented by different backends (Tauri IPC, HTTP, etc.)
 */

export type { ApiClient } from "./client";
export { isTauriEnvironment } from "./client";
export { TauriClient } from "./tauri-client";
export { HttpClient } from "./http-client";

import type { ApiClient } from "./client";
import { isTauriEnvironment } from "./client";
import { TauriClient } from "./tauri-client";
import { HttpClient } from "./http-client";

// Preserve the singleton across HMR so Tauri event listeners are not orphaned.
let apiClient: ApiClient | null =
  (import.meta.hot?.data as { apiClient?: ApiClient } | undefined)?.apiClient ??
  null;

/**
 * Get or create the API client.
 * Automatically detects whether to use Tauri or HTTP based on the environment.
 */
export function getApiClient(): ApiClient {
  if (!apiClient) {
    apiClient = createApiClient();
  }
  if (import.meta.hot) {
    import.meta.hot.data.apiClient = apiClient;
  }
  return apiClient;
}

/**
 * Create a new API client based on the current environment.
 */
export function createApiClient(): ApiClient {
  if (isTauriEnvironment()) {
    console.log("[api] Using TauriClient");
    return new TauriClient();
  } else {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? localStorage.getItem("reviewToken");
    if (token) {
      localStorage.setItem("reviewToken", token);
    }
    console.log("[api] Using HttpClient (companion server)");
    return new HttpClient(undefined, token);
  }
}

/**
 * Override the API client (useful for testing).
 */
export function setApiClient(client: ApiClient): void {
  apiClient = client;
}
