/**
 * HTTP Client Implementation
 *
 * Implements ApiClient using fetch() for browser-based usage.
 * Used when running the UI outside of Tauri (web mode).
 */

import type { ApiClient } from "./client";
import type {
  BranchList,
  ClassifyResponse,
  Comparison,
  CommitDetail,
  CommitEntry,
  CommitOutputLine,
  CommitResult,
  DetectMovePairsResponse,
  DiffHunk,
  DiffShortStat,
  ExpandedContext,
  FileContent,
  FileEntry,
  FileSymbol,
  FileSymbolDiff,
  RepoFileSymbols,
  GitHubPrRef,
  GitStatusSummary,
  GroupingEvent,
  GroupingInput,
  HunkGroup,
  ModifiedSymbolEntry,
  PullRequest,
  RemoteInfo,
  RepoLocalActivity,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
  ReviewState,
  ReviewSummary,
  GlobalReviewSummary,
  SearchMatch,
  SymbolDefinition,
  LspServerStatus,
  TrustCategory,
  WorktreeInfo,
} from "../types";

export class HttpClient implements ApiClient {
  // ----- Streaming callback registries -----

  private groupingCallbacks = new Map<string, (event: GroupingEvent) => void>();
  private commitCallbacks = new Map<string, (line: CommitOutputLine) => void>();
  private commitMessageCallbacks = new Map<string, (chunk: string) => void>();

  // ----- File watcher (EventSource) -----

  private eventSource: EventSource | null = null;
  private reviewStateCallbacks: ((repoPath: string) => void)[] = [];
  private gitChangedCallbacks: ((repoPath: string) => void)[] = [];
  private localActivityCallbacks: ((repoPath: string) => void)[] = [];

  // ----- Private helpers -----

  private async post<T>(url: string, body?: unknown): Promise<T> {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  private async consumeSSE<T>(
    resp: Response,
    onEvent?: (data: unknown) => void,
  ): Promise<T> {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastResult: T | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentData = "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          currentData += line.slice(6);
        } else if (line.startsWith("event: ")) {
          // event type - could use for routing
        } else if (line === "" && currentData) {
          // End of event
          try {
            const parsed = JSON.parse(currentData);
            if (parsed.type === "result" || parsed.type === "done") {
              lastResult = parsed.data;
            } else if (onEvent) {
              onEvent(parsed);
            }
          } catch {
            /* ignore parse errors */
          }
          currentData = "";
        }
      }
    }

    if (lastResult === undefined)
      throw new Error("SSE stream ended without result");
    return lastResult;
  }

  private stopFileWatcherSync(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // ----- Git operations -----

  async getCurrentRepo(): Promise<string> {
    return this.post("/api/git/current-repo");
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    return this.post("/api/git/current-branch", { repoPath });
  }

  async getRemoteInfo(repoPath: string): Promise<RemoteInfo | null> {
    try {
      return await this.post<RemoteInfo>("/api/git/remote-info", { repoPath });
    } catch {
      return null;
    }
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    return this.post("/api/git/default-branch", { repoPath });
  }

  async listBranches(repoPath: string): Promise<BranchList> {
    return this.post("/api/git/branches", { repoPath });
  }

  async getGitStatus(repoPath: string): Promise<GitStatusSummary> {
    return this.post("/api/git/status", { repoPath });
  }

  async getGitStatusRaw(repoPath: string): Promise<string> {
    return this.post("/api/git/status-raw", { repoPath });
  }

  async stageFile(repoPath: string, path: string): Promise<void> {
    await this.post("/api/git/stage-file", { repoPath, path });
  }

  async unstageFile(repoPath: string, path: string): Promise<void> {
    await this.post("/api/git/unstage-file", { repoPath, path });
  }

  async unstageAll(repoPath: string): Promise<void> {
    await this.post("/api/git/unstage-all", { repoPath });
  }

  async stageHunks(
    repoPath: string,
    filePath: string,
    contentHashes: string[],
  ): Promise<void> {
    await this.post("/api/git/stage-hunks", {
      repoPath,
      filePath,
      contentHashes,
    });
  }

  async unstageHunks(
    repoPath: string,
    filePath: string,
    contentHashes: string[],
  ): Promise<void> {
    await this.post("/api/git/unstage-hunks", {
      repoPath,
      filePath,
      contentHashes,
    });
  }

  async getWorkingTreeFileContent(
    repoPath: string,
    filePath: string,
    cached: boolean,
  ): Promise<FileContent> {
    return this.post("/api/git/working-tree-file-content", {
      repoPath,
      filePath,
      cached,
    });
  }

  async getDiffShortStat(
    repoPath: string,
    comparison: Comparison,
  ): Promise<DiffShortStat> {
    return this.post("/api/git/diff-shortstat", { repoPath, comparison });
  }

  async listCommits(
    repoPath: string,
    limit?: number,
    branch?: string,
    range?: string,
  ): Promise<CommitEntry[]> {
    return this.post("/api/git/commits", {
      repoPath,
      limit: limit ?? null,
      branch: branch ?? null,
      range: range ?? null,
    });
  }

  async getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail> {
    return this.post("/api/git/commit-detail", { repoPath, hash });
  }

  // ----- GitHub -----

  async checkGitHubAvailable(repoPath: string): Promise<boolean> {
    try {
      return await this.post<boolean>("/api/github/available", { repoPath });
    } catch {
      return false;
    }
  }

  async listPullRequests(repoPath: string): Promise<PullRequest[]> {
    return this.post("/api/github/pull-requests", { repoPath });
  }

  // ----- Worktree operations -----

  async createReviewWorktree(
    repoPath: string,
    name: string,
    gitRef: string,
  ): Promise<WorktreeInfo> {
    return this.post("/api/worktree/create", { repoPath, name, gitRef });
  }

  async removeReviewWorktree(
    repoPath: string,
    worktreePath: string,
  ): Promise<void> {
    return this.post("/api/worktree/remove", { repoPath, worktreePath });
  }

  async resolveRef(repoPath: string, gitRef: string): Promise<string> {
    return this.post("/api/git/resolve-ref", { repoPath, gitRef });
  }

  async hasWorktreeChanges(
    repoPath: string,
    worktreePath: string,
  ): Promise<boolean> {
    return this.post("/api/worktree/has-changes", { repoPath, worktreePath });
  }

  async updateWorktreeHead(
    repoPath: string,
    worktreePath: string,
    commitSha: string,
  ): Promise<void> {
    return this.post("/api/worktree/update-head", {
      repoPath,
      worktreePath,
      commitSha,
    });
  }

  // ----- File operations -----

  async listFiles(
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<FileEntry[]> {
    return this.post("/api/files/list", {
      repoPath,
      comparison,
      githubPr: githubPr ?? null,
    });
  }

  async listAllFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    return this.post("/api/files/list-all", { repoPath, comparison });
  }

  async listRepoFiles(repoPath: string): Promise<FileEntry[]> {
    return this.post("/api/files/list-repo", { repoPath });
  }

  async listDirectoryContents(
    repoPath: string,
    dirPath: string,
  ): Promise<FileEntry[]> {
    return this.post("/api/files/directory-contents", { repoPath, dirPath });
  }

  async getFileContent(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<FileContent> {
    return this.post("/api/files/content", {
      repoPath,
      filePath,
      comparison,
      githubPr: githubPr ?? null,
    });
  }

  async getAllHunks(
    repoPath: string,
    comparison: Comparison,
    filePaths: string[],
  ): Promise<DiffHunk[]> {
    return this.post("/api/files/all-hunks", {
      repoPath,
      comparison,
      filePaths,
    });
  }

  async getExpandedContext(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    startLine: number,
    endLine: number,
    githubPr?: GitHubPrRef,
  ): Promise<ExpandedContext> {
    return this.post("/api/files/expanded-context", {
      repoPath,
      filePath,
      comparison,
      startLine,
      endLine,
      githubPr: githubPr ?? null,
    });
  }

  async searchFileContents(
    repoPath: string,
    query: string,
    caseSensitive: boolean,
    maxResults: number,
  ): Promise<SearchMatch[]> {
    return this.post("/api/files/search", {
      repoPath,
      query,
      caseSensitive,
      maxResults,
    });
  }

  // ----- Review state -----

  async loadReviewState(
    repoPath: string,
    comparison: Comparison,
  ): Promise<ReviewState> {
    return this.post("/api/review/load", { repoPath, comparison });
  }

  async saveReviewState(repoPath: string, state: ReviewState): Promise<number> {
    return this.post("/api/review/save", { repoPath, state });
  }

  async listSavedReviews(repoPath: string): Promise<ReviewSummary[]> {
    return this.post("/api/review/list", { repoPath });
  }

  async changeReviewBase(
    repoPath: string,
    oldComparison: Comparison,
    newBase: string,
  ): Promise<Comparison> {
    return this.post("/api/review/change-base", {
      repoPath,
      oldComparison,
      newBase,
    });
  }

  async deleteReview(repoPath: string, comparison: Comparison): Promise<void> {
    await this.post("/api/review/delete", { repoPath, comparison });
  }

  async reviewExists(
    repoPath: string,
    comparison: Comparison,
  ): Promise<boolean> {
    return this.post("/api/review/exists", { repoPath, comparison });
  }

  async ensureReviewExists(
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<void> {
    await this.post("/api/review/ensure-exists", {
      repoPath,
      comparison,
      githubPr: githubPr ?? null,
    });
  }

  async listAllReviewsGlobal(): Promise<GlobalReviewSummary[]> {
    return this.post("/api/review/list-global");
  }

  async getReviewRoot(): Promise<string> {
    return this.post("/api/review/root");
  }

  async getReviewStoragePath(repoPath: string): Promise<string> {
    return this.post("/api/review/storage-path", { repoPath });
  }

  async checkReviewsFreshness(
    reviews: ReviewFreshnessInput[],
  ): Promise<ReviewFreshnessResult[]> {
    return this.post("/api/review/freshness", { reviews });
  }

  // ----- Classification -----

  async classifyHunksStatic(hunks: DiffHunk[]): Promise<ClassifyResponse> {
    return this.post("/api/classify/static", { hunks });
  }

  async detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse> {
    return this.post("/api/classify/move-pairs", { hunks });
  }

  // ----- Grouping -----

  async generateGrouping(
    repoPath: string,
    hunks: GroupingInput[],
    options?: { modifiedSymbols?: ModifiedSymbolEntry[]; requestId?: string },
  ): Promise<HunkGroup[]> {
    const requestId = options?.requestId ?? crypto.randomUUID();
    const resp = await fetch("/api/streaming/generate-grouping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath,
        hunks,
        modifiedSymbols: options?.modifiedSymbols ?? null,
        requestId,
      }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return this.consumeSSE<HunkGroup[]>(resp, (event) => {
      const cb = this.groupingCallbacks.get(requestId);
      if (cb) cb(event as GroupingEvent);
    });
  }

  onGroupingEvent(
    requestId: string,
    callback: (event: GroupingEvent) => void,
  ): () => void {
    this.groupingCallbacks.set(requestId, callback);
    return () => {
      this.groupingCallbacks.delete(requestId);
    };
  }

  async cancelGrouping(requestId: string): Promise<void> {
    await this.post("/api/streaming/cancel-grouping", { requestId });
  }

  // ----- Commit -----

  async gitCommit(
    repoPath: string,
    message: string,
    requestId: string,
  ): Promise<CommitResult> {
    const resp = await fetch("/api/streaming/git-commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath, message, requestId }),
    });
    if (!resp.ok) throw new Error(await resp.text());

    const cb = this.commitCallbacks.get(requestId);
    return this.consumeSSE<CommitResult>(resp, (event) => {
      if (cb) cb(event as CommitOutputLine);
    });
  }

  onCommitOutput(
    requestId: string,
    callback: (line: CommitOutputLine) => void,
  ): () => void {
    this.commitCallbacks.set(requestId, callback);
    return () => {
      this.commitCallbacks.delete(requestId);
    };
  }

  // ----- Commit message generation -----

  async generateCommitMessage(
    repoPath: string,
    requestId: string,
  ): Promise<string> {
    const resp = await fetch("/api/streaming/generate-commit-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath, requestId }),
    });
    if (!resp.ok) throw new Error(await resp.text());

    const cb = this.commitMessageCallbacks.get(requestId);
    return this.consumeSSE<string>(resp, (event) => {
      if (cb) {
        // Commit message chunks are plain strings
        const chunk =
          typeof event === "string"
            ? event
            : ((event as { text?: string }).text ?? "");
        cb(chunk);
      }
    });
  }

  onCommitMessageChunk(
    requestId: string,
    callback: (chunk: string) => void,
  ): () => void {
    this.commitMessageCallbacks.set(requestId, callback);
    return () => {
      this.commitMessageCallbacks.delete(requestId);
    };
  }

  // ----- Trust patterns -----

  async getTrustTaxonomy(): Promise<TrustCategory[]> {
    return this.post("/api/trust/taxonomy");
  }

  async matchTrustPattern(label: string, pattern: string): Promise<boolean> {
    return this.post("/api/trust/match", { label, pattern });
  }

  async shouldSkipFile(path: string): Promise<boolean> {
    return this.post("/api/trust/skip-file", { path });
  }

  // ----- Symbols -----

  async getFileSymbolDiffs(
    repoPath: string,
    filePaths: string[],
    comparison: Comparison,
  ): Promise<FileSymbolDiff[]> {
    return this.post("/api/symbols/diffs", {
      repoPath,
      filePaths,
      comparison,
    });
  }

  async findSymbolDefinitions(
    repoPath: string,
    symbolName: string,
    gitRef?: string,
  ): Promise<SymbolDefinition[]> {
    return this.post("/api/symbols/definitions", {
      repoPath,
      symbolName,
      gitRef: gitRef ?? null,
    });
  }

  async getFileSymbols(
    repoPath: string,
    filePath: string,
    gitRef?: string,
  ): Promise<FileSymbol[] | null> {
    return this.post("/api/symbols/file", {
      repoPath,
      filePath,
      gitRef: gitRef ?? null,
    });
  }

  async getRepoSymbols(repoPath: string): Promise<RepoFileSymbols[]> {
    return this.post("/api/symbols/repo", { repoPath });
  }

  // ----- Local activity -----

  async listAllLocalActivity(): Promise<RepoLocalActivity[]> {
    return this.post("/api/activity/list");
  }

  async registerRepo(repoPath: string): Promise<boolean> {
    return this.post("/api/activity/register", { repoPath });
  }

  async unregisterRepo(repoPath: string): Promise<void> {
    await this.post("/api/activity/unregister", { repoPath });
  }

  // ----- File watcher -----

  async startFileWatcher(repoPath: string): Promise<void> {
    this.stopFileWatcherSync();
    this.eventSource = new EventSource(
      `/api/events?repoPath=${encodeURIComponent(repoPath)}`,
    );
    this.eventSource.addEventListener("review-state-changed", (e) => {
      this.reviewStateCallbacks.forEach((cb) =>
        cb((e as MessageEvent).data || repoPath),
      );
    });
    this.eventSource.addEventListener("git-changed", (e) => {
      this.gitChangedCallbacks.forEach((cb) =>
        cb((e as MessageEvent).data || repoPath),
      );
    });
    this.eventSource.addEventListener("local-activity-changed", (e) => {
      this.localActivityCallbacks.forEach((cb) =>
        cb((e as MessageEvent).data || repoPath),
      );
    });
  }

  async stopFileWatcher(_repoPath: string): Promise<void> {
    this.stopFileWatcherSync();
  }

  // ----- Events -----

  onReviewStateChanged(callback: (repoPath: string) => void): () => void {
    this.reviewStateCallbacks.push(callback);
    return () => {
      this.reviewStateCallbacks = this.reviewStateCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  onGitChanged(callback: (repoPath: string) => void): () => void {
    this.gitChangedCallbacks.push(callback);
    return () => {
      this.gitChangedCallbacks = this.gitChangedCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  onLocalActivityChanged(callback: (repoPath: string) => void): () => void {
    this.localActivityCallbacks.push(callback);
    return () => {
      this.localActivityCallbacks = this.localActivityCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  // ----- Window/App -----

  async consumeCliRequest(): Promise<{
    repoPath: string;
    comparisonKey: string | null;
    focusedFile: string | null;
  } | null> {
    return null;
  }

  async openRepoWindow(_repoPath: string): Promise<void> {
    window.open("/", "_blank");
  }

  async isGitRepo(path: string): Promise<boolean> {
    return this.post("/api/misc/is-git-repo", { path });
  }

  async pathIsFile(path: string): Promise<boolean> {
    return this.post("/api/misc/path-is-file", { path });
  }

  async readRawFile(path: string): Promise<FileContent> {
    return this.post("/api/files/read-raw", { path });
  }

  async getFileRawContent(
    repoPath: string,
    filePath: string,
  ): Promise<FileContent> {
    return this.post("/api/files/raw-content", { repoPath, filePath });
  }

  async listDirectoryPlain(dirPath: string): Promise<FileEntry[]> {
    return this.post("/api/files/directory-plain", { dirPath });
  }

  // ----- LSP (desktop-only) -----

  async initLspServers(): Promise<LspServerStatus[]> {
    return [];
  }

  async stopAllLspServers(): Promise<void> {}

  async restartLspServer(): Promise<LspServerStatus> {
    throw new Error("LSP not available in web mode");
  }

  async discoverLspServers(): Promise<LspServerStatus[]> {
    return [];
  }

  async lspGotoDefinition(): Promise<SymbolDefinition[]> {
    return [];
  }

  async lspHover(): Promise<unknown | null> {
    return null;
  }

  async lspFindReferences(): Promise<SymbolDefinition[]> {
    return [];
  }

  // ----- VS Code theme -----

  async detectVscodeTheme(): Promise<{
    name: string;
    themeType: string;
    colors: Record<string, string>;
    tokenColors: unknown[];
  }> {
    return this.post("/api/misc/vscode-theme");
  }

  async setWindowBackgroundColor(
    _r: number,
    _g: number,
    _b: number,
  ): Promise<void> {
    // No-op in browser
  }

  async openSettingsFile(): Promise<void> {
    // No-op in browser
  }

  // ----- Agent -----

  async agentSendMessage(): Promise<never> {
    throw new Error("Agent not supported in web mode");
  }

  onAgentEvent(): () => void {
    return () => {};
  }

  async agentCancel(): Promise<void> {
    // No-op in web mode
  }

  // ----- Web-only methods -----

  async resolveRepoPath(routePrefix: string): Promise<string | null> {
    return this.post("/api/misc/resolve-repo-path", { routePrefix });
  }
}
