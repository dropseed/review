/**
 * API Layer
 *
 * Provides a unified interface for backend operations.
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
 */
export function getApiClient(): ApiClient {
  if (!apiClient) {
    apiClient = isTauriEnvironment() ? new TauriClient() : new HttpClient();
  }
  if (import.meta.hot) {
    import.meta.hot.data.apiClient = apiClient;
  }
  return apiClient;
}
