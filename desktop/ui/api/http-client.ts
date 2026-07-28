/**
 * HTTP Client Implementation
 *
 * Implements ApiClient using fetch() for browser-based usage.
 * Used when running the UI outside of Tauri (web mode).
 */

import type {
  ApiClient,
  GitChangedPayload,
  RepoActivityChangedPayload,
} from "./client";
import { TerminalSocket } from "./terminal-socket";
import type {
  BranchList,
  ClassifyResponse,
  Comparison,
  CommitDetail,
  CommitEntry,
  HunkAttribution,
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
  AgentUsage,
  ReviewTierInfo,
  GitStatusSummary,
  PullRequest,
  RemoteInfo,
  RepoLocalActivity,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
  ReviewState,
  ReviewLoadResult,
  ResolvedReview,
  ReviewSummary,
  GlobalReviewSummary,
  SearchMatch,
  SymbolDefinition,
  LspServerStatus,
  TrustCategory,
  WorktreeInfo,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalOutput,
  TerminalExit,
  TerminalReplay,
} from "../types";

export class HttpClient implements ApiClient {
  // ----- Streaming callback registries -----

  private commitCallbacks = new Map<string, (line: CommitOutputLine) => void>();
  private commitMessageCallbacks = new Map<string, (chunk: string) => void>();

  // ----- File watcher (EventSource) -----

  private eventSource: EventSource | null = null;
  private reviewStateCallbacks: ((repoPath: string) => void)[] = [];
  private gitChangedCallbacks: ((payload: GitChangedPayload) => void)[] = [];
  private repoActivityCallbacks: ((
    payload: RepoActivityChangedPayload,
  ) => void)[] = [];

  // ----- Terminal transport (one WebSocket per session) -----

  private terminalSockets = new Map<string, TerminalSocket>();
  private terminalOutputCallbacks = new Map<
    string,
    Set<(output: TerminalOutput) => void>
  >();
  private terminalStatusCallbacks = new Map<
    string,
    Set<(status: TerminalStatus) => void>
  >();
  private terminalExitCallbacks = new Map<
    string,
    Set<(exit: TerminalExit) => void>
  >();
  private terminalStatusChangedCallbacks = new Set<
    (status: TerminalStatus) => void
  >();

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

  async getGitUser(repoPath: string): Promise<string | null> {
    return this.post("/api/git/user", { repoPath });
  }

  async getRemoteInfo(repoPath: string): Promise<RemoteInfo | null> {
    try {
      return await this.post<RemoteInfo | null>("/api/git/remote-info", {
        repoPath,
      });
    } catch {
      return null;
    }
  }

  async fetchOrigin(repoPath: string): Promise<void> {
    await this.post<null>("/api/git/fetch-origin", { repoPath });
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

  async getHunkAttribution(
    repoPath: string,
    base: string,
    head: string,
  ): Promise<HunkAttribution> {
    return this.post("/api/git/hunk-attribution", {
      repoPath,
      comparison: { base, head, key: `${base}..${head}` },
    });
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

  // ----- Review tiers -----

  async getReviewTier(repoPath: string, ref: string): Promise<ReviewTierInfo> {
    return this.post("/api/review/tier", { repoPath, ref });
  }

  async getAgentUsage(force = false): Promise<AgentUsage[]> {
    return this.post("/api/usage/agents", { force });
  }

  async fetchPullRequest(repoPath: string, pr: GitHubPrRef): Promise<string> {
    return this.post("/api/github/fetch-pull-request", { repoPath, pr });
  }

  async materializeReview(repoPath: string, ref: string): Promise<string> {
    return this.post("/api/review/materialize", { repoPath, ref });
  }

  async releaseReviewWorktree(repoPath: string, ref: string): Promise<void> {
    return this.post("/api/review/release-worktree", { repoPath, ref });
  }

  async reclaimClosedPrs(repoPath: string): Promise<string[]> {
    return this.post("/api/github/reclaim-closed", { repoPath });
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
  ): Promise<FileEntry[]> {
    return this.post("/api/files/list", {
      repoPath,
      comparison,
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
  ): Promise<FileContent> {
    return this.post("/api/files/content", {
      repoPath,
      filePath,
      comparison,
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
  ): Promise<ExpandedContext> {
    return this.post("/api/files/expanded-context", {
      repoPath,
      filePath,
      comparison,
      startLine,
      endLine,
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

  async resolveReview(
    repoPath: string,
    ref: string,
    baseOverride?: string,
  ): Promise<ResolvedReview> {
    return this.post("/api/review/resolve", {
      repoPath,
      ref,
      baseOverride: baseOverride ?? null,
    });
  }

  async loadReviewState(repoPath: string, ref: string): Promise<ReviewState> {
    return this.post("/api/review/load", { repoPath, ref });
  }

  async reconcileReviewState(
    state: ReviewState,
    hunks: DiffHunk[],
  ): Promise<ReviewLoadResult> {
    return this.post("/api/review/reconcile", { state, hunks });
  }

  async saveReviewState(
    repoPath: string,
    state: ReviewState,
    hunks?: DiffHunk[],
  ): Promise<number> {
    return this.post("/api/review/save", { repoPath, state, hunks });
  }

  async listSavedReviews(repoPath: string): Promise<ReviewSummary[]> {
    return this.post("/api/review/list", { repoPath });
  }

  async setBaseOverride(
    repoPath: string,
    ref: string,
    baseOverride: string | null,
  ): Promise<ResolvedReview> {
    return this.post("/api/review/set-base-override", {
      repoPath,
      ref,
      baseOverride,
    });
  }

  async deleteReview(repoPath: string, ref: string): Promise<void> {
    await this.post("/api/review/delete", { repoPath, ref });
  }

  async reviewExists(repoPath: string, ref: string): Promise<boolean> {
    return this.post("/api/review/exists", { repoPath, ref });
  }

  async ensureReviewExists(
    repoPath: string,
    ref: string,
    baseOverride?: string,
    githubPr?: GitHubPrRef,
  ): Promise<void> {
    await this.post("/api/review/ensure-exists", {
      repoPath,
      ref,
      baseOverride: baseOverride ?? null,
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
      const data = (e as MessageEvent).data;
      let payload: GitChangedPayload;
      try {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        payload = {
          repoPath: parsed?.repoPath ?? repoPath,
          changedPaths: Array.isArray(parsed?.changedPaths)
            ? parsed.changedPaths
            : [],
          gitStateChanged: Boolean(parsed?.gitStateChanged),
        };
      } catch {
        // Fall back to an unknown-paths event so we don't silently drop signals.
        payload = { repoPath, changedPaths: [], gitStateChanged: false };
      }
      this.gitChangedCallbacks.forEach((cb) => cb(payload));
    });
    this.eventSource.addEventListener("repo-activity-changed", (e) => {
      const data = (e as MessageEvent).data;
      try {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        if (parsed && parsed.repoPath && parsed.activity) {
          const payload: RepoActivityChangedPayload = {
            repoPath: parsed.repoPath,
            activity: parsed.activity,
          };
          this.repoActivityCallbacks.forEach((cb) => cb(payload));
        }
      } catch {
        // Malformed payload — drop it rather than dispatch a partial event.
      }
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

  onGitChanged(callback: (payload: GitChangedPayload) => void): () => void {
    this.gitChangedCallbacks.push(callback);
    return () => {
      this.gitChangedCallbacks = this.gitChangedCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  onRepoActivityChanged(
    callback: (payload: RepoActivityChangedPayload) => void,
  ): () => void {
    this.repoActivityCallbacks.push(callback);
    return () => {
      this.repoActivityCallbacks = this.repoActivityCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  // ----- Window/App -----

  async consumeCliRequest(): Promise<{
    repoPath: string;
    ref: string | null;
    focusedFile: string | null;
    focusedHunkHash: string | null;
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

  // ----- Web-only methods -----

  async resolveRepoPath(routePrefix: string): Promise<string | null> {
    return this.post("/api/misc/resolve-repo-path", { routePrefix });
  }

  // ----- Terminals (web mode: WebSocket transport) -----
  //
  // PTY bytes flow over a per-session WebSocket (`/api/terminal/{id}/ws`);
  // control (start/kill/list/peek/replay/available) stays plain POST. Each
  // `TerminalSocket` fans its decoded frames into the callback registries
  // above, mirroring the shapes TauriClient delivers so the rest of the app is
  // transport-agnostic.

  /**
   * Get (creating if needed) the session's socket and make sure it's
   * connecting. Only called from paths where the session already exists
   * server-side (start / pane output subscribe), so we never open a socket to a
   * session that hasn't been created yet.
   */
  private ensureTerminalSocket(terminalId: string): TerminalSocket {
    let socket = this.terminalSockets.get(terminalId);
    if (!socket) {
      socket = new TerminalSocket(terminalId, {
        onOutput: (data, seq) => {
          const cbs = this.terminalOutputCallbacks.get(terminalId);
          if (cbs) for (const cb of cbs) cb({ id: terminalId, data, seq });
        },
        onStatus: (status) => {
          const cbs = this.terminalStatusCallbacks.get(status.id);
          if (cbs) for (const cb of cbs) cb(status);
          for (const cb of this.terminalStatusChangedCallbacks) cb(status);
        },
        onExit: (exitCode) => {
          const cbs = this.terminalExitCallbacks.get(terminalId);
          if (cbs) for (const cb of cbs) cb({ id: terminalId, exitCode });
        },
      });
      this.terminalSockets.set(terminalId, socket);
    }
    socket.connect();
    return socket;
  }

  async terminalsAvailable(): Promise<boolean> {
    return this.post<boolean>("/api/terminal/available").catch(() => false);
  }

  async terminalStart(params: {
    terminalId: string;
    repoPath: string;
    cwd: string;
    cols: number;
    rows: number;
    shell?: string;
  }): Promise<TerminalSessionInfo> {
    const info = await this.post<TerminalSessionInfo>("/api/terminal/start", {
      terminalId: params.terminalId,
      repoPath: params.repoPath,
      cwd: params.cwd,
      cols: params.cols,
      rows: params.rows,
      shell: params.shell ?? null,
    });
    // Session exists now — open its socket so output/status start flowing.
    this.ensureTerminalSocket(params.terminalId);
    return info;
  }

  async terminalWrite(terminalId: string, data: string): Promise<void> {
    const socket = this.terminalSockets.get(terminalId);
    if (socket && socket.isOpen()) {
      socket.sendInput(data);
      return;
    }
    // Socket not up yet (rare race before the pane's replay opens it): fall
    // back to the HTTP write so keystrokes aren't lost.
    await this.post("/api/terminal/write", { terminalId, data });
  }

  async terminalResize(
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const socket = this.terminalSockets.get(terminalId);
    if (socket && socket.isOpen()) {
      socket.sendResize(cols, rows);
      return;
    }
    await this.post("/api/terminal/resize", { terminalId, cols, rows });
  }

  async terminalKill(terminalId: string): Promise<void> {
    try {
      await this.post("/api/terminal/kill", { terminalId });
    } finally {
      const socket = this.terminalSockets.get(terminalId);
      if (socket) {
        socket.close();
        this.terminalSockets.delete(terminalId);
      }
    }
  }

  async terminalList(repoPath?: string): Promise<TerminalSessionInfo[]> {
    return this.post("/api/terminal/list", { repoPath: repoPath ?? null });
  }

  async terminalShutdownAllBackground(): Promise<void> {
    throw new Error("Background session shutdown is not available in web mode");
  }

  /** Web-mode replay: a one-shot POST returning the ring buffer plus status. */
  async terminalReplay(terminalId: string): Promise<TerminalReplay> {
    return this.post("/api/terminal/replay", { terminalId });
  }

  async terminalPeek(terminalId: string): Promise<string> {
    return this.post("/api/terminal/peek", { terminalId });
  }

  /**
   * Add `callback` to a per-session callback registry, returning an
   * unsubscribe that removes it. Shared by the output/status/exit subscribers.
   */
  private registerTerminalCallback<T>(
    registry: Map<string, Set<(payload: T) => void>>,
    terminalId: string,
    callback: (payload: T) => void,
  ): () => void {
    let set = registry.get(terminalId);
    if (!set) {
      set = new Set();
      registry.set(terminalId, set);
    }
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  }

  onTerminalOutput(
    terminalId: string,
    callback: (output: TerminalOutput) => void,
  ): () => void {
    const unsubscribe = this.registerTerminalCallback(
      this.terminalOutputCallbacks,
      terminalId,
      callback,
    );
    // A mounted pane wants output, which means the session exists — open the
    // socket so its live output reaches this callback.
    this.ensureTerminalSocket(terminalId);
    return unsubscribe;
  }

  onTerminalStatus(
    terminalId: string,
    callback: (status: TerminalStatus) => void,
  ): () => void {
    // Registration only — the socket is opened by start/output, never by a bare
    // subscribe (which the slice does BEFORE the session exists).
    return this.registerTerminalCallback(
      this.terminalStatusCallbacks,
      terminalId,
      callback,
    );
  }

  onTerminalStatusChanged(
    callback: (status: TerminalStatus) => void,
  ): () => void {
    this.terminalStatusChangedCallbacks.add(callback);
    return () => {
      this.terminalStatusChangedCallbacks.delete(callback);
    };
  }

  onTerminalExit(
    terminalId: string,
    callback: (exit: TerminalExit) => void,
  ): () => void {
    return this.registerTerminalCallback(
      this.terminalExitCallbacks,
      terminalId,
      callback,
    );
  }
}
