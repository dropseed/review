/**
 * HTTP Client Implementation
 *
 * Implements ApiClient using HTTP requests to the debug server.
 * Used in browser testing and future web version.
 */

import type { ApiClient } from "./client";
import type {
  BranchList,
  GitStatusSummary,
  Comparison,
  CommitEntry,
  CommitDetail,
  FileEntry,
  FileContent,
  ReviewState,
  ReviewSummary,
  TrustCategory,
  DiffHunk,
  ClassifyResponse,
  HunkInput,
  ClassifyOptions,
  DetectMovePairsResponse,
  ExpandedContext,
  SearchMatch,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:3333";

export class HttpClient implements ApiClient {
  private baseUrl: string;
  private reviewStates = new Map<string, ReviewState>();
  private currentComparison: Comparison | null = null;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // ----- Helper methods -----

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.log(`[HttpClient] GET ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    return response.json();
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.log(`[HttpClient] POST ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    return response.json();
  }

  private async deleteRequest<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.log(`[HttpClient] DELETE ${url}`);

    const response = await fetch(url, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    return response.json();
  }

  private buildRepoQuery(repoPath: string): string {
    return `repo=${encodeURIComponent(repoPath)}`;
  }

  private buildComparisonQuery(comparison: Comparison): string {
    const parts = [
      `old=${encodeURIComponent(comparison.old)}`,
      `new=${encodeURIComponent(comparison.new)}`,
    ];
    if (comparison.workingTree) {
      parts.push("workingTree=true");
    }
    if (comparison.stagedOnly) {
      parts.push("stagedOnly=true");
    }
    return parts.join("&");
  }

  private getComparisonKey(comparison: Comparison): string {
    return comparison.key || `${comparison.old}..${comparison.new}`;
  }

  // ----- Git operations -----

  async getCurrentRepo(): Promise<string> {
    const result = await this.fetchJson<{ path: string }>("/repo");
    return result.path;
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const result = await this.fetchJson<{ branch: string }>(
        `/current-branch?${this.buildRepoQuery(repoPath)}`,
      );
      return result.branch;
    } catch {
      // Fallback to status
      const status = await this.getGitStatus(repoPath);
      return status.currentBranch || "main";
    }
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const result = await this.fetchJson<{ branch: string }>(
        `/default-branch?${this.buildRepoQuery(repoPath)}`,
      );
      return result.branch;
    } catch {
      return "main";
    }
  }

  async listBranches(repoPath: string): Promise<BranchList> {
    return this.fetchJson<BranchList>(
      `/branches?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async getGitStatus(repoPath: string): Promise<GitStatusSummary> {
    return this.fetchJson<GitStatusSummary>(
      `/status?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async getGitStatusRaw(repoPath: string): Promise<string> {
    // Try to get raw status from server
    try {
      const result = await this.fetchJson<{ raw: string }>(
        `/status/raw?${this.buildRepoQuery(repoPath)}`,
      );
      return result.raw;
    } catch {
      return "Raw git status not available";
    }
  }

  async listCommits(
    _repoPath: string,
    _limit?: number,
    _branch?: string,
  ): Promise<CommitEntry[]> {
    console.warn("[HttpClient] listCommits not implemented");
    return [];
  }

  async getCommitDetail(
    _repoPath: string,
    _hash: string,
  ): Promise<CommitDetail> {
    console.warn("[HttpClient] getCommitDetail not implemented");
    return {
      hash: "",
      shortHash: "",
      message: "",
      author: "",
      authorEmail: "",
      date: "",
      files: [],
    };
  }

  // ----- File operations -----

  async listFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    return this.fetchJson<FileEntry[]>(
      `/files?${this.buildRepoQuery(repoPath)}&${this.buildComparisonQuery(comparison)}`,
    );
  }

  async listAllFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    return this.fetchJson<FileEntry[]>(
      `/files?${this.buildRepoQuery(repoPath)}&${this.buildComparisonQuery(comparison)}&all=true`,
    );
  }

  async getFileContent(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
  ): Promise<FileContent> {
    return this.fetchJson<FileContent>(
      `/file?${this.buildRepoQuery(repoPath)}&path=${encodeURIComponent(filePath)}&${this.buildComparisonQuery(comparison)}`,
    );
  }

  async getExpandedContext(
    _repoPath: string,
    _filePath: string,
    _comparison: Comparison,
    startLine: number,
    endLine: number,
  ): Promise<ExpandedContext> {
    // Not implemented in HTTP server yet - return empty
    console.warn("[HttpClient] getExpandedContext not implemented");
    return { lines: [], startLine, endLine };
  }

  async searchFileContents(
    _repoPath: string,
    _query: string,
    _caseSensitive: boolean,
    _maxResults: number,
  ): Promise<SearchMatch[]> {
    // Not implemented in HTTP server yet - return empty
    console.warn("[HttpClient] searchFileContents not implemented");
    return [];
  }

  // ----- Review state -----

  async loadReviewState(
    repoPath: string,
    comparison: Comparison,
  ): Promise<ReviewState> {
    const key = this.getComparisonKey(comparison);

    // Check local cache first
    if (this.reviewStates.has(key)) {
      return this.reviewStates.get(key)!;
    }

    // Try to load from server
    try {
      const state = await this.fetchJson<ReviewState>(
        `/state?${this.buildRepoQuery(repoPath)}&${this.buildComparisonQuery(comparison)}`,
      );
      this.reviewStates.set(key, state);
      return state;
    } catch {
      // Return empty state
      const emptyState: ReviewState = {
        comparison,
        hunks: {},
        trustList: [],
        notes: "",
        annotations: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 0,
      };
      this.reviewStates.set(key, emptyState);
      return emptyState;
    }
  }

  async saveReviewState(repoPath: string, state: ReviewState): Promise<void> {
    const key = this.getComparisonKey(state.comparison);
    this.reviewStates.set(key, state);

    // Try to save to server (may not be implemented yet)
    try {
      await this.postJson(`/state?${this.buildRepoQuery(repoPath)}`, state);
    } catch (err) {
      console.warn("[HttpClient] Failed to save state to server:", err);
      // State is still saved locally in memory
    }
  }

  async listSavedReviews(repoPath: string): Promise<ReviewSummary[]> {
    try {
      return await this.fetchJson<ReviewSummary[]>(
        `/reviews?${this.buildRepoQuery(repoPath)}`,
      );
    } catch {
      // Not implemented - return empty
      return [];
    }
  }

  async deleteReview(repoPath: string, comparison: Comparison): Promise<void> {
    const key = this.getComparisonKey(comparison);
    this.reviewStates.delete(key);

    // Try to delete from server
    try {
      await this.deleteRequest(
        `/state?${this.buildRepoQuery(repoPath)}&${this.buildComparisonQuery(comparison)}`,
      );
    } catch (err) {
      console.warn("[HttpClient] Failed to delete state from server:", err);
    }
  }

  async getCurrentComparison(repoPath: string): Promise<Comparison | null> {
    // Try to get from server first
    try {
      const result = await this.fetchJson<{ comparison: Comparison | null }>(
        `/comparison?${this.buildRepoQuery(repoPath)}`,
      );
      this.currentComparison = result.comparison;
      return result.comparison;
    } catch {
      // Fallback to local cache
      return this.currentComparison;
    }
  }

  async setCurrentComparison(
    repoPath: string,
    comparison: Comparison,
  ): Promise<void> {
    this.currentComparison = comparison;

    // Try to save to server
    try {
      await this.postJson(`/comparison?${this.buildRepoQuery(repoPath)}`, {
        comparison,
      });
    } catch (err) {
      console.warn("[HttpClient] Failed to save comparison to server:", err);
    }
  }

  // ----- Classification -----

  async checkClaudeAvailable(): Promise<boolean> {
    // Claude CLI not available in browser
    return false;
  }

  async classifyHunks(
    _repoPath: string,
    _hunks: HunkInput[],
    _options?: ClassifyOptions,
  ): Promise<ClassifyResponse> {
    // Classification not available in browser yet
    console.warn("[HttpClient] classifyHunks not implemented");
    return { classifications: {} };
  }

  async detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse> {
    // Try server-side detection
    try {
      return await this.postJson<DetectMovePairsResponse>("/detect-moves", {
        hunks,
      });
    } catch {
      // Fallback: return hunks as-is with no pairs
      return { pairs: [], hunks };
    }
  }

  // ----- Trust patterns -----

  async getTrustTaxonomy(): Promise<TrustCategory[]> {
    try {
      return await this.fetchJson<TrustCategory[]>("/taxonomy");
    } catch {
      return [];
    }
  }

  async getTrustTaxonomyWithCustom(repoPath: string): Promise<TrustCategory[]> {
    try {
      return await this.fetchJson<TrustCategory[]>(
        `/taxonomy?${this.buildRepoQuery(repoPath)}`,
      );
    } catch {
      return [];
    }
  }

  async matchTrustPattern(label: string, pattern: string): Promise<boolean> {
    // Simple pattern matching in browser
    if (pattern.endsWith(":*")) {
      const category = pattern.slice(0, -2);
      return label.startsWith(category + ":");
    }
    return label === pattern;
  }

  async shouldSkipFile(path: string): Promise<boolean> {
    // Inline skip pattern matching for browser mode
    const skipPatterns = [
      /^target\//, // Rust build artifacts
      /\/target\//, // Nested target directories
      /\.fingerprint\//, // Cargo fingerprints
      /^node_modules\//, // Node dependencies
      /\/node_modules\//, // Nested node_modules
      /\.git\//, // Git internals
      /__pycache__\//, // Python bytecode
      /\.pyc$/, // Python bytecode files
      /^dist\//, // Common build dir
      /^build\//, // Common build dir
      /\/\.next\//, // Next.js build cache
      /^\.next\//, // Next.js build cache
      /package-lock\.json$/, // Lock files
      /yarn\.lock$/,
      /Cargo\.lock$/,
      /pnpm-lock\.yaml$/,
    ];
    return skipPatterns.some((pattern) => pattern.test(path));
  }

  // ----- File watcher -----

  async startFileWatcher(_repoPath: string): Promise<void> {
    // File watching not available in browser
    console.log("[HttpClient] File watching not available in browser");
  }

  async stopFileWatcher(_repoPath: string): Promise<void> {
    // No-op
  }

  // ----- Events -----

  onClassifyProgress(_callback: (completedIds: string[]) => void): () => void {
    // Events not available in HTTP mode yet (would need WebSocket)
    return () => {};
  }

  onReviewStateChanged(_callback: (repoPath: string) => void): () => void {
    // Events not available in HTTP mode yet
    return () => {};
  }

  onGitChanged(_callback: (repoPath: string) => void): () => void {
    // Events not available in HTTP mode yet
    return () => {};
  }

  // ----- Window/App -----

  async openRepoWindow(_repoPath: string): Promise<void> {
    // Can't open windows from browser
    console.warn("[HttpClient] openRepoWindow not available in browser");
  }
}
