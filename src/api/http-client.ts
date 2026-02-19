/**
 * HTTP Client Implementation
 *
 * Implements ApiClient using HTTP requests to the companion server.
 * Used in browser testing and future web version.
 */

import type { ApiClient } from "./client";
import type {
  BranchList,
  GitStatusSummary,
  Comparison,
  GitHubPrRef,
  PullRequest,
  CommitEntry,
  CommitDetail,
  DiffShortStat,
  FileEntry,
  FileContent,
  ReviewState,
  ReviewSummary,
  GlobalReviewSummary,
  TrustCategory,
  DiffHunk,
  ClassifyResponse,
  DetectMovePairsResponse,
  ExpandedContext,
  SearchMatch,
  FileSymbol,
  FileSymbolDiff,
  RepoFileSymbols,
  SymbolDefinition,
  RemoteInfo,
  GroupingInput,
  HunkGroup,
  ModifiedSymbolEntry,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
} from "../types";

const DEFAULT_BASE_URL = "https://localhost:3333";

export class HttpClient implements ApiClient {
  private baseUrl: string;
  private token: string | null;
  private reviewStates = new Map<string, ReviewState>();

  constructor(baseUrl: string = DEFAULT_BASE_URL, token?: string | null) {
    this.baseUrl = baseUrl;
    this.token = token ?? null;
  }

  private authHeaders(): Record<string, string> {
    if (this.token) {
      return { Authorization: `Bearer ${this.token}` };
    }
    return {};
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.log(`[HttpClient] ${method} ${url}`);

    const headers: Record<string, string> = { ...this.authHeaders() };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    return response.json();
  }

  private async fetchJson<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  private async deleteJson<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private buildRepoQuery(repoPath: string): string {
    return `repo=${encodeURIComponent(repoPath)}`;
  }

  private buildComparisonPath(comparison: Comparison): string {
    return `${encodeURIComponent(comparison.base)}..${encodeURIComponent(comparison.head)}`;
  }

  private getComparisonKey(comparison: Comparison): string {
    return comparison.key || `${comparison.base}..${comparison.head}`;
  }

  // ----- Git operations -----

  async getCurrentRepo(): Promise<string> {
    const result = await this.fetchJson<{ path: string }>("/git/repo");
    return result.path;
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const result = await this.fetchJson<{ branch: string }>(
        `/git/branch/current?${this.buildRepoQuery(repoPath)}`,
      );
      return result.branch;
    } catch {
      // Fallback to status
      const status = await this.getGitStatus(repoPath);
      return status.currentBranch || "main";
    }
  }

  async getRemoteInfo(repoPath: string): Promise<RemoteInfo | null> {
    try {
      return await this.fetchJson<RemoteInfo>(
        `/git/remote?${this.buildRepoQuery(repoPath)}`,
      );
    } catch {
      return null;
    }
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const result = await this.fetchJson<{ branch: string }>(
        `/git/branch/default?${this.buildRepoQuery(repoPath)}`,
      );
      return result.branch;
    } catch {
      return "main";
    }
  }

  async listBranches(repoPath: string): Promise<BranchList> {
    return this.fetchJson<BranchList>(
      `/git/branches?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async getGitStatus(repoPath: string): Promise<GitStatusSummary> {
    return this.fetchJson<GitStatusSummary>(
      `/git/status?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async getGitStatusRaw(repoPath: string): Promise<string> {
    // Try to get raw status from server
    try {
      const result = await this.fetchJson<{ raw: string }>(
        `/git/status/raw?${this.buildRepoQuery(repoPath)}`,
      );
      return result.raw;
    } catch {
      return "Raw git status not available";
    }
  }

  async stageFile(_repoPath: string, _path: string): Promise<void> {
    console.warn("[HttpClient] stageFile not implemented");
  }

  async unstageFile(_repoPath: string, _path: string): Promise<void> {
    console.warn("[HttpClient] unstageFile not implemented");
  }

  async stageAll(_repoPath: string): Promise<void> {
    console.warn("[HttpClient] stageAll not implemented");
  }

  async unstageAll(_repoPath: string): Promise<void> {
    console.warn("[HttpClient] unstageAll not implemented");
  }

  async stageHunks(
    _repoPath: string,
    _filePath: string,
    _contentHashes: string[],
  ): Promise<void> {
    console.warn("[HttpClient] stageHunks not implemented");
  }

  async unstageHunks(
    _repoPath: string,
    _filePath: string,
    _contentHashes: string[],
  ): Promise<void> {
    console.warn("[HttpClient] unstageHunks not implemented");
  }

  async getWorkingTreeFileContent(
    _repoPath: string,
    _filePath: string,
    _cached: boolean,
  ): Promise<FileContent> {
    console.warn("[HttpClient] getWorkingTreeFileContent not implemented");
    return {
      content: "",
      diffPatch: "",
      hunks: [],
      contentType: "text",
    };
  }

  async getDiffShortStat(
    repoPath: string,
    comparison: Comparison,
  ): Promise<DiffShortStat> {
    const compPath = this.buildComparisonPath(comparison);
    return this.fetchJson<DiffShortStat>(
      `/comparisons/${compPath}/diff/shortstat?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async listCommits(
    repoPath: string,
    limit?: number,
    branch?: string,
  ): Promise<CommitEntry[]> {
    let query = this.buildRepoQuery(repoPath);
    if (limit != null) query += `&limit=${limit}`;
    if (branch) query += `&branch=${encodeURIComponent(branch)}`;
    return this.fetchJson<CommitEntry[]>(`/git/commits?${query}`);
  }

  async getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail> {
    return this.fetchJson<CommitDetail>(
      `/git/commits/${encodeURIComponent(hash)}?${this.buildRepoQuery(repoPath)}`,
    );
  }

  // ----- GitHub -----

  async checkGitHubAvailable(repoPath: string): Promise<boolean> {
    try {
      const result = await this.fetchJson<{ available: boolean }>(
        `/github/available?${this.buildRepoQuery(repoPath)}`,
      );
      return result.available;
    } catch {
      return false;
    }
  }

  async listPullRequests(repoPath: string): Promise<PullRequest[]> {
    try {
      return await this.fetchJson<PullRequest[]>(
        `/github/prs?${this.buildRepoQuery(repoPath)}`,
      );
    } catch {
      return [];
    }
  }

  // ----- File operations -----

  async listFiles(
    repoPath: string,
    comparison: Comparison,
    _githubPr?: GitHubPrRef,
  ): Promise<FileEntry[]> {
    const compPath = this.buildComparisonPath(comparison);
    return this.fetchJson<FileEntry[]>(
      `/comparisons/${compPath}/files?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async listAllFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    const compPath = this.buildComparisonPath(comparison);
    return this.fetchJson<FileEntry[]>(
      `/comparisons/${compPath}/files?${this.buildRepoQuery(repoPath)}&all=true`,
    );
  }

  async listDirectoryContents(
    repoPath: string,
    dirPath: string,
  ): Promise<FileEntry[]> {
    return this.fetchJson<FileEntry[]>(
      `/directories/${encodeURIComponent(dirPath)}?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async getFileContent(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    _githubPr?: GitHubPrRef,
  ): Promise<FileContent> {
    const compPath = this.buildComparisonPath(comparison);
    return this.fetchJson<FileContent>(
      `/comparisons/${compPath}/files/${encodeURIComponent(filePath)}?${this.buildRepoQuery(repoPath)}`,
    );
  }

  async getExpandedContext(
    _repoPath: string,
    _filePath: string,
    _comparison: Comparison,
    startLine: number,
    endLine: number,
    _githubPr?: GitHubPrRef,
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
      const compPath = this.buildComparisonPath(comparison);
      const state = await this.fetchJson<ReviewState>(
        `/comparisons/${compPath}/review?${this.buildRepoQuery(repoPath)}`,
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
        totalDiffHunks: 0,
      };
      this.reviewStates.set(key, emptyState);
      return emptyState;
    }
  }

  async saveReviewState(repoPath: string, state: ReviewState): Promise<number> {
    const key = this.getComparisonKey(state.comparison);
    const newVersion = (state.version ?? 0) + 1;
    const updated = { ...state, version: newVersion };
    this.reviewStates.set(key, updated);

    // Try to save to server (may not be implemented yet)
    try {
      const compPath = this.buildComparisonPath(state.comparison);
      await this.putJson(
        `/comparisons/${compPath}/review?${this.buildRepoQuery(repoPath)}`,
        updated,
      );
    } catch (err) {
      console.warn("[HttpClient] Failed to save state to server:", err);
      // State is still saved locally in memory
    }
    return newVersion;
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
      const compPath = this.buildComparisonPath(comparison);
      await this.deleteJson(
        `/comparisons/${compPath}/review?${this.buildRepoQuery(repoPath)}`,
      );
    } catch (err) {
      console.warn("[HttpClient] Failed to delete state from server:", err);
    }
  }

  async reviewExists(
    repoPath: string,
    comparison: Comparison,
  ): Promise<boolean> {
    try {
      const compPath = this.buildComparisonPath(comparison);
      await this.fetchJson(
        `/comparisons/${compPath}/review?${this.buildRepoQuery(repoPath)}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  async ensureReviewExists(
    _repoPath: string,
    _comparison: Comparison,
    _githubPr?: GitHubPrRef,
  ): Promise<void> {
    // In HTTP mode, review state is managed in-memory; no-op
  }

  async listAllReviewsGlobal(): Promise<GlobalReviewSummary[]> {
    return this.fetchJson<GlobalReviewSummary[]>("/reviews");
  }

  async getReviewStoragePath(_repoPath: string): Promise<string> {
    console.warn("[HttpClient] getReviewStoragePath not implemented");
    return "";
  }

  // ----- Classification -----

  async classifyHunksStatic(_hunks: DiffHunk[]): Promise<ClassifyResponse> {
    // Static classification not available in browser yet
    return { classifications: {} };
  }

  async detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse> {
    // Try server-side detection
    try {
      return await this.postJson<DetectMovePairsResponse>(
        "/actions/detect-moves",
        { hunks },
      );
    } catch {
      // Fallback: return hunks as-is with no pairs
      return { pairs: [], hunks };
    }
  }

  // ----- Grouping -----

  async generateGrouping(
    _repoPath: string,
    _hunks: GroupingInput[],
    _options?: { modifiedSymbols?: ModifiedSymbolEntry[] },
  ): Promise<HunkGroup[]> {
    console.warn("[HttpClient] generateGrouping not implemented");
    return [];
  }

  onGroupingGroup(_callback: (group: HunkGroup) => void): () => void {
    return () => {};
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

  // ----- Symbols -----

  async findSymbolDefinitions(
    _repoPath: string,
    _symbolName: string,
  ): Promise<SymbolDefinition[]> {
    console.warn("[HttpClient] findSymbolDefinitions not implemented");
    return [];
  }

  async getFileSymbolDiffs(
    _repoPath: string,
    _filePaths: string[],
    _comparison: Comparison,
  ): Promise<FileSymbolDiff[]> {
    console.warn("[HttpClient] getFileSymbolDiffs not implemented");
    return [];
  }

  async getFileSymbols(
    _repoPath: string,
    _filePath: string,
    _gitRef?: string,
  ): Promise<FileSymbol[] | null> {
    console.warn("[HttpClient] getFileSymbols not implemented");
    return null;
  }

  async getRepoSymbols(_repoPath: string): Promise<RepoFileSymbols[]> {
    console.warn("[HttpClient] getRepoSymbols not implemented");
    return [];
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

  async checkReviewsFreshness(
    reviews: ReviewFreshnessInput[],
  ): Promise<ReviewFreshnessResult[]> {
    // In browser mode, return all as active
    return reviews.map((r) => ({
      key: `${r.repoPath}:${r.comparison.key}`,
      isActive: true,
      oldSha: null,
      newSha: null,
      diffStats: null,
    }));
  }

  async isGitRepo(_path: string): Promise<boolean> {
    // In browser mode, assume it's a git repo (server validates)
    console.warn("[HttpClient] isGitRepo not available in browser");
    return true;
  }

  // ----- VS Code theme -----

  async detectVscodeTheme(): Promise<{
    name: string;
    themeType: string;
    colors: Record<string, string>;
    tokenColors: unknown[];
  }> {
    throw new Error("VS Code theme detection not available in browser");
  }

  async setWindowBackgroundColor(
    _r: number,
    _g: number,
    _b: number,
  ): Promise<void> {
    // No-op in browser
  }

  async openSettingsFile(): Promise<void> {
    console.warn("[HttpClient] openSettingsFile not available in browser");
  }
}
