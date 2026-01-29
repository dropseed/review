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

// Re-export types
export type {
  BranchList,
  StashEntry,
  GitStatusSummary,
  StatusEntry,
  Comparison,
  FileEntry,
  DiffHunk,
  DiffLine,
  MovePair,
  HunkState,
  LineAnnotation,
  RejectionFeedback,
  ClassificationResult,
  ClassifyResponse,
  ReviewState,
  ReviewSummary,
  TrustPattern,
  TrustCategory,
  ContentType,
  FileContent,
  HunkInput,
  ClassifyOptions,
  DetectMovePairsResponse,
  ExpandedContext,
  SearchMatch,
  SymbolKind,
  SymbolChangeType,
  LineRange,
  SymbolDiff,
  FileSymbolDiff,
  RemoteInfo,
} from "./types";

import type { ApiClient } from "./client";
import { isTauriEnvironment } from "./client";
import { TauriClient } from "./tauri-client";
import { HttpClient } from "./http-client";

// Singleton instance
let apiClient: ApiClient | null = null;

/**
 * Get or create the API client.
 * Automatically detects whether to use Tauri or HTTP based on the environment.
 */
export function getApiClient(): ApiClient {
  if (!apiClient) {
    apiClient = createApiClient();
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
    console.log("[api] Using HttpClient (debug server)");
    return new HttpClient();
  }
}

/**
 * Override the API client (useful for testing).
 */
export function setApiClient(client: ApiClient): void {
  apiClient = client;
}
