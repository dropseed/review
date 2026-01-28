/**
 * Sync Client API
 *
 * Client for connecting to the desktop sync server from the iOS app.
 * Handles HTTP requests, WebSocket connections, and state synchronization.
 */

import type { ReviewState, FileEntry, TrustCategory } from "./types";
import type { FileContent } from "./types";

export interface SyncClientConfig {
  serverUrl: string;
  authToken: string;
}

export interface RepoInfo {
  id: string;
  path: string;
  name: string;
}

export interface ComparisonInfo {
  key: string;
  old: string;
  new: string;
  workingTree: boolean;
  stagedOnly: boolean;
  updatedAt: string;
}

export interface SyncEvent {
  type: "state_changed" | "client_connected" | "client_disconnected";
  repo?: string;
  comparisonKey?: string;
  version?: number;
  clientId?: string;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Client for syncing with the desktop Compare app.
 */
export class SyncClient {
  private config: SyncClientConfig;
  private ws: WebSocket | null = null;
  private eventListeners: Set<(event: SyncEvent) => void> = new Set();
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: ConnectionStatus = "disconnected";

  constructor(config: SyncClientConfig) {
    this.config = config;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  /**
   * Update the configuration (e.g., when server URL changes).
   */
  updateConfig(config: Partial<SyncClientConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get authorization headers.
   */
  private getHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.config.authToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Make an authenticated request to the server.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.serverUrl}${path}`;
    console.log(`[SyncClient] ${method} ${url}`);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      console.log(
        `[SyncClient] Response: ${response.status} ${response.statusText}`,
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw new SyncError(response.status, error.error || "Request failed");
      }

      const data = await response.json();
      console.log(`[SyncClient] Data:`, JSON.stringify(data));
      return data;
    } catch (error) {
      if (error instanceof SyncError) {
        throw error;
      }
      console.error(`[SyncClient] Request failed:`, error);
      throw new SyncError(
        0,
        error instanceof Error ? error.message : "Network error",
      );
    }
  }

  // --- Connection Management ---

  /**
   * Connect to the server and establish WebSocket for real-time updates.
   */
  async connect(): Promise<void> {
    this.setStatus("connecting");
    console.log("[SyncClient] Connecting to:", this.config.serverUrl);

    try {
      // Test connection with health check
      console.log("[SyncClient] Performing health check...");
      const health = await this.healthCheck();
      console.log("[SyncClient] Health check passed:", health);

      // Establish WebSocket connection
      console.log("[SyncClient] Establishing WebSocket...");
      this.connectWebSocket();

      this.setStatus("connected");
      console.log("[SyncClient] Connected successfully");
    } catch (error) {
      console.error("[SyncClient] Connection failed:", error);
      this.setStatus("error");
      throw error;
    }
  }

  /**
   * Disconnect from the server.
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus("disconnected");
  }

  /**
   * Establish WebSocket connection for real-time events.
   */
  private connectWebSocket() {
    const wsUrl =
      this.config.serverUrl.replace(/^http/, "ws").replace(/\/$/, "") +
      "/api/events";

    // Include auth token in WebSocket URL as query param (since headers aren't supported)
    const ws = new WebSocket(wsUrl, [`bearer-${this.config.authToken}`]);

    ws.onopen = () => {
      console.log("[SyncClient] WebSocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SyncEvent;
        this.eventListeners.forEach((listener) => listener(data));
      } catch (error) {
        console.error("[SyncClient] Failed to parse WebSocket message:", error);
      }
    };

    ws.onclose = () => {
      console.log("[SyncClient] WebSocket disconnected");
      this.ws = null;

      // Attempt to reconnect if we were connected
      if (this._status === "connected") {
        this.setStatus("connecting");
        this.reconnectTimer = setTimeout(() => {
          this.connectWebSocket();
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      console.error("[SyncClient] WebSocket error:", error);
    };

    this.ws = ws;
  }

  /**
   * Subscribe to sync events.
   */
  onEvent(callback: (event: SyncEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Subscribe to connection status changes.
   */
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  // --- API Methods ---

  /**
   * Health check to verify server is reachable.
   */
  async healthCheck(): Promise<{ ok: boolean; version: string }> {
    return this.request("GET", "/api/health");
  }

  /**
   * List available repositories.
   */
  async listRepos(): Promise<RepoInfo[]> {
    return this.request("GET", "/api/repos");
  }

  /**
   * Get repository info.
   */
  async getRepoInfo(repoId: string): Promise<RepoInfo> {
    return this.request("GET", `/api/repos/${encodeURIComponent(repoId)}`);
  }

  /**
   * List comparisons/reviews for a repository.
   */
  async listComparisons(repoId: string): Promise<ComparisonInfo[]> {
    return this.request(
      "GET",
      `/api/comparisons/${encodeURIComponent(repoId)}`,
    );
  }

  /**
   * Get review state for a comparison.
   */
  async getState(repoId: string, comparisonKey: string): Promise<ReviewState> {
    const response = await this.request<{ state: ReviewState }>(
      "GET",
      `/api/state/${encodeURIComponent(repoId)}/${encodeURIComponent(comparisonKey)}`,
    );
    return response.state;
  }

  /**
   * Update review state with optimistic concurrency control.
   * Throws SyncConflictError if version mismatch.
   */
  async updateState(
    repoId: string,
    comparisonKey: string,
    state: ReviewState,
    expectedVersion: number,
  ): Promise<ReviewState> {
    try {
      const response = await this.request<{ state: ReviewState }>(
        "PATCH",
        `/api/state/${encodeURIComponent(repoId)}/${encodeURIComponent(comparisonKey)}`,
        { state, expected_version: expectedVersion },
      );
      return response.state;
    } catch (error) {
      if (error instanceof SyncError && error.status === 409) {
        throw new SyncConflictError(error.message);
      }
      throw error;
    }
  }

  /**
   * Get file list for a comparison.
   */
  async getFiles(repoId: string, comparisonKey: string): Promise<FileEntry[]> {
    const response = await this.request<{ files: FileEntry[] }>(
      "GET",
      `/api/diff/${encodeURIComponent(repoId)}/${encodeURIComponent(comparisonKey)}`,
    );
    return response.files;
  }

  /**
   * Get file content and diff.
   */
  async getFileContent(
    repoId: string,
    comparisonKey: string,
    filePath: string,
  ): Promise<FileContent> {
    const response = await this.request<{ content: FileContent }>(
      "GET",
      `/api/diff/${encodeURIComponent(repoId)}/${encodeURIComponent(comparisonKey)}/${encodeURIComponent(filePath)}`,
    );
    return response.content;
  }

  /**
   * Get trust taxonomy.
   */
  async getTaxonomy(repoId?: string): Promise<TrustCategory[]> {
    if (repoId) {
      return this.request("GET", `/api/taxonomy/${encodeURIComponent(repoId)}`);
    }
    return this.request("GET", "/api/taxonomy");
  }
}

/**
 * Error thrown for sync-related issues.
 */
export class SyncError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/**
 * Error thrown when there's a version conflict.
 */
export class SyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncConflictError";
  }
}

/**
 * Create a sync client instance.
 */
export function createSyncClient(config: SyncClientConfig): SyncClient {
  return new SyncClient(config);
}

/**
 * Encode a repository path to a URL-safe ID.
 */
export function encodeRepoId(path: string): string {
  // Base64 URL-safe encoding (same as server)
  return btoa(path).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a repository ID back to path.
 */
export function decodeRepoId(id: string): string {
  const base64 = id.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}
