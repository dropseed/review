/**
 * Tauri Client Implementation
 *
 * Implements ApiClient using Tauri's IPC (invoke) and event system.
 * Used in the desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
  AgentEvent,
  AgentResult,
} from "../types";

/** Event names emitted by the Rust watcher. Must match constants in watchers.rs. */
const EVENT_REVIEW_STATE_CHANGED = "review-state-changed";
const EVENT_GIT_CHANGED = "git-changed";
const EVENT_LOCAL_ACTIVITY_CHANGED = "local-activity-changed";

export class TauriClient implements ApiClient {
  // ----- Git operations -----

  async getCurrentRepo(): Promise<string> {
    return invoke<string>("get_current_repo");
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    return invoke<string>("get_current_branch", { repoPath });
  }

  async getRemoteInfo(repoPath: string): Promise<RemoteInfo | null> {
    try {
      return await invoke<RemoteInfo>("get_remote_info", { repoPath });
    } catch {
      return null;
    }
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    return invoke<string>("get_default_branch", { repoPath });
  }

  async listBranches(repoPath: string): Promise<BranchList> {
    return invoke<BranchList>("list_branches", { repoPath });
  }

  async getGitStatus(repoPath: string): Promise<GitStatusSummary> {
    return invoke<GitStatusSummary>("get_git_status", { repoPath });
  }

  async getGitStatusRaw(repoPath: string): Promise<string> {
    return invoke<string>("get_git_status_raw", { repoPath });
  }

  async stageFile(repoPath: string, path: string): Promise<void> {
    await invoke("stage_file", { repoPath, path });
  }

  async unstageFile(repoPath: string, path: string): Promise<void> {
    await invoke("unstage_file", { repoPath, path });
  }

  async unstageAll(repoPath: string): Promise<void> {
    await invoke("unstage_all", { repoPath });
  }

  async stageHunks(
    repoPath: string,
    filePath: string,
    contentHashes: string[],
  ): Promise<void> {
    await invoke("stage_hunks", { repoPath, filePath, contentHashes });
  }

  async unstageHunks(
    repoPath: string,
    filePath: string,
    contentHashes: string[],
  ): Promise<void> {
    await invoke("unstage_hunks", { repoPath, filePath, contentHashes });
  }

  async getWorkingTreeFileContent(
    repoPath: string,
    filePath: string,
    cached: boolean,
  ): Promise<FileContent> {
    return invoke<FileContent>("get_working_tree_file_content", {
      repoPath,
      filePath,
      cached,
    });
  }

  async getDiffShortStat(
    repoPath: string,
    comparison: Comparison,
  ): Promise<DiffShortStat> {
    return invoke<DiffShortStat>("get_diff_shortstat", {
      repoPath,
      comparison,
    });
  }

  async listCommits(
    repoPath: string,
    limit?: number,
    branch?: string,
    range?: string,
  ): Promise<CommitEntry[]> {
    return invoke<CommitEntry[]>("list_commits", {
      repoPath,
      limit,
      branch,
      range,
    });
  }

  async getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail> {
    return invoke<CommitDetail>("get_commit_detail", { repoPath, hash });
  }

  // ----- GitHub -----

  async checkGitHubAvailable(repoPath: string): Promise<boolean> {
    try {
      return await invoke<boolean>("check_github_available", { repoPath });
    } catch {
      return false;
    }
  }

  async listPullRequests(repoPath: string): Promise<PullRequest[]> {
    return invoke<PullRequest[]>("list_pull_requests", { repoPath });
  }

  // ----- Worktree operations -----

  async createReviewWorktree(
    repoPath: string,
    name: string,
    gitRef: string,
  ): Promise<WorktreeInfo> {
    return invoke<WorktreeInfo>("create_review_worktree", {
      repoPath,
      name,
      gitRef,
    });
  }

  async removeReviewWorktree(
    repoPath: string,
    worktreePath: string,
  ): Promise<void> {
    return invoke<void>("remove_review_worktree", { repoPath, worktreePath });
  }

  async resolveRef(repoPath: string, gitRef: string): Promise<string> {
    return invoke<string>("resolve_ref", { repoPath, gitRef });
  }

  async hasWorktreeChanges(
    repoPath: string,
    worktreePath: string,
  ): Promise<boolean> {
    return invoke<boolean>("has_worktree_changes", { repoPath, worktreePath });
  }

  async updateWorktreeHead(
    repoPath: string,
    worktreePath: string,
    commitSha: string,
  ): Promise<void> {
    return invoke<void>("update_worktree_head", {
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
    return invoke<FileEntry[]>("list_files", {
      repoPath,
      comparison,
      githubPr: githubPr ?? null,
    });
  }

  async listAllFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_all_files", { repoPath, comparison });
  }

  async listRepoFiles(repoPath: string): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_repo_files", { repoPath });
  }

  async listDirectoryContents(
    repoPath: string,
    dirPath: string,
  ): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_directory_contents", {
      repoPath,
      dirPath,
    });
  }

  async getFileContent(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<FileContent> {
    return invoke<FileContent>("get_file_content", {
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
    return invoke<DiffHunk[]>("get_all_hunks", {
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
    return invoke<ExpandedContext>("get_expanded_context", {
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
    return invoke<SearchMatch[]>("search_file_contents", {
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
    return invoke<ReviewState>("load_review_state", { repoPath, comparison });
  }

  async saveReviewState(repoPath: string, state: ReviewState): Promise<number> {
    return invoke<number>("save_review_state", { repoPath, state });
  }

  async listSavedReviews(repoPath: string): Promise<ReviewSummary[]> {
    return invoke<ReviewSummary[]>("list_saved_reviews", { repoPath });
  }

  async changeReviewBase(
    repoPath: string,
    oldComparison: Comparison,
    newBase: string,
  ): Promise<Comparison> {
    return invoke<Comparison>("change_review_base", {
      repoPath,
      oldComparison,
      newBase,
    });
  }

  async deleteReview(repoPath: string, comparison: Comparison): Promise<void> {
    await invoke("delete_review", { repoPath, comparison });
  }

  async reviewExists(
    repoPath: string,
    comparison: Comparison,
  ): Promise<boolean> {
    return invoke<boolean>("review_exists", { repoPath, comparison });
  }

  async ensureReviewExists(
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<void> {
    await invoke("ensure_review_exists", {
      repoPath,
      comparison,
      githubPr: githubPr ?? null,
    });
  }

  async listAllReviewsGlobal(): Promise<GlobalReviewSummary[]> {
    return invoke<GlobalReviewSummary[]>("list_all_reviews_global");
  }

  async getReviewRoot(): Promise<string> {
    return invoke<string>("get_review_root");
  }

  async getReviewStoragePath(repoPath: string): Promise<string> {
    return invoke<string>("get_review_storage_path", { repoPath });
  }

  // ----- Classification -----

  async classifyHunksStatic(hunks: DiffHunk[]): Promise<ClassifyResponse> {
    return invoke<ClassifyResponse>("classify_hunks_static", { hunks });
  }

  async detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse> {
    return invoke<DetectMovePairsResponse>("detect_hunks_move_pairs", {
      hunks,
    });
  }

  // ----- Commit -----

  async gitCommit(
    repoPath: string,
    message: string,
    requestId: string,
  ): Promise<CommitResult> {
    return invoke<CommitResult>("git_commit", { repoPath, message, requestId });
  }

  onCommitOutput(
    requestId: string,
    callback: (line: CommitOutputLine) => void,
  ): () => void {
    return this.listenForEvent(`commit:output:${requestId}`, callback);
  }

  // ----- Commit message generation -----

  async generateCommitMessage(
    repoPath: string,
    requestId: string,
  ): Promise<string> {
    return invoke<string>("generate_commit_message", { repoPath, requestId });
  }

  onCommitMessageChunk(
    requestId: string,
    callback: (chunk: string) => void,
  ): () => void {
    return this.listenForEvent(`commit-message:chunk:${requestId}`, callback);
  }

  // ----- Grouping -----

  async generateGrouping(
    repoPath: string,
    hunks: GroupingInput[],
    options?: { modifiedSymbols?: ModifiedSymbolEntry[]; requestId?: string },
  ): Promise<HunkGroup[]> {
    return invoke<HunkGroup[]>("generate_hunk_grouping", {
      repoPath,
      hunks,
      modifiedSymbols: options?.modifiedSymbols ?? null,
      requestId: options?.requestId ?? null,
    });
  }

  onGroupingEvent(
    requestId: string,
    callback: (event: GroupingEvent) => void,
  ): () => void {
    return this.listenForEvent(`grouping:event:${requestId}`, callback);
  }

  async cancelGrouping(requestId: string): Promise<void> {
    await invoke("cancel_hunk_grouping", { requestId });
  }

  // ----- Trust patterns -----

  async getTrustTaxonomy(): Promise<TrustCategory[]> {
    return invoke<TrustCategory[]>("get_trust_taxonomy");
  }

  async matchTrustPattern(label: string, pattern: string): Promise<boolean> {
    return invoke<boolean>("match_trust_pattern", { label, pattern });
  }

  async shouldSkipFile(path: string): Promise<boolean> {
    return invoke<boolean>("should_skip_file", { path });
  }

  // ----- Symbols -----

  async findSymbolDefinitions(
    repoPath: string,
    symbolName: string,
    gitRef?: string,
  ): Promise<SymbolDefinition[]> {
    return invoke<SymbolDefinition[]>("find_symbol_definitions", {
      repoPath,
      symbolName,
      gitRef,
    });
  }

  async getFileSymbolDiffs(
    repoPath: string,
    filePaths: string[],
    comparison: Comparison,
  ): Promise<FileSymbolDiff[]> {
    return invoke<FileSymbolDiff[]>("get_file_symbol_diffs", {
      repoPath,
      filePaths,
      comparison,
    });
  }

  async getFileSymbols(
    repoPath: string,
    filePath: string,
    gitRef?: string,
  ): Promise<FileSymbol[] | null> {
    return invoke<FileSymbol[] | null>("get_file_symbols", {
      repoPath,
      filePath,
      gitRef: gitRef ?? null,
    });
  }

  async getRepoSymbols(repoPath: string): Promise<RepoFileSymbols[]> {
    return invoke<RepoFileSymbols[]>("get_repo_symbols", { repoPath });
  }

  // ----- Local activity -----

  async listAllLocalActivity(): Promise<RepoLocalActivity[]> {
    return invoke<RepoLocalActivity[]>("list_all_local_activity");
  }

  async registerRepo(repoPath: string): Promise<boolean> {
    return invoke<boolean>("register_repo", { repoPath });
  }

  async unregisterRepo(repoPath: string): Promise<void> {
    await invoke("unregister_repo", { repoPath });
  }

  // ----- File watcher -----

  async startFileWatcher(repoPath: string): Promise<void> {
    await invoke("start_file_watcher", { repoPath });
  }

  async stopFileWatcher(repoPath: string): Promise<void> {
    await invoke("stop_file_watcher", { repoPath });
  }

  // ----- Events -----

  /** Subscribe to a Tauri event, returning a synchronous unsubscribe function. */
  private listenForEvent<T>(
    eventName: string,
    callback: (payload: T) => void,
  ): () => void {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<T>(eventName, (event) => {
      if (!cancelled) callback(event.payload);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.error(`Failed to listen for ${eventName}:`, err);
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };
  }

  onReviewStateChanged(callback: (repoPath: string) => void): () => void {
    return this.listenForEvent(EVENT_REVIEW_STATE_CHANGED, callback);
  }

  onGitChanged(callback: (repoPath: string) => void): () => void {
    return this.listenForEvent(EVENT_GIT_CHANGED, callback);
  }

  onLocalActivityChanged(callback: (repoPath: string) => void): () => void {
    return this.listenForEvent(EVENT_LOCAL_ACTIVITY_CHANGED, callback);
  }

  // ----- Window/App -----

  async consumeCliRequest(): Promise<{
    repoPath: string;
    comparisonKey: string | null;
    focusedFile: string | null;
  } | null> {
    return invoke("consume_cli_request");
  }

  async openRepoWindow(repoPath: string): Promise<void> {
    await invoke("open_repo_window", { repoPath });
  }

  async checkReviewsFreshness(
    reviews: ReviewFreshnessInput[],
  ): Promise<ReviewFreshnessResult[]> {
    return invoke<ReviewFreshnessResult[]>("check_reviews_freshness", {
      reviews,
    });
  }

  async isGitRepo(path: string): Promise<boolean> {
    return invoke<boolean>("is_git_repo", { path });
  }

  async pathIsFile(path: string): Promise<boolean> {
    return invoke<boolean>("path_is_file", { path });
  }

  async readRawFile(path: string): Promise<FileContent> {
    return invoke<FileContent>("read_raw_file", { path });
  }

  async getFileRawContent(
    repoPath: string,
    filePath: string,
  ): Promise<FileContent> {
    return invoke<FileContent>("get_file_raw_content", { repoPath, filePath });
  }

  async listDirectoryPlain(dirPath: string): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_directory_plain", { dirPath });
  }

  // ----- LSP -----

  async initLspServers(repoPath: string): Promise<LspServerStatus[]> {
    return invoke<LspServerStatus[]>("init_lsp_servers", { repoPath });
  }

  async stopAllLspServers(repoPath: string): Promise<void> {
    await invoke("stop_all_lsp_servers", { repoPath });
  }

  async restartLspServer(
    repoPath: string,
    language: string,
  ): Promise<LspServerStatus> {
    return invoke<LspServerStatus>("restart_lsp_server", {
      repoPath,
      language,
    });
  }

  async discoverLspServers(repoPath: string): Promise<LspServerStatus[]> {
    return invoke<LspServerStatus[]>("discover_lsp_servers", { repoPath });
  }

  async lspGotoDefinition(
    repoPath: string,
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolDefinition[]> {
    return invoke<SymbolDefinition[]>("lsp_goto_definition", {
      repoPath,
      filePath,
      line,
      character,
    });
  }

  async lspHover(
    repoPath: string,
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    return invoke("lsp_hover", { repoPath, filePath, line, character });
  }

  async lspFindReferences(
    repoPath: string,
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolDefinition[]> {
    return invoke<SymbolDefinition[]>("lsp_find_references", {
      repoPath,
      filePath,
      line,
      character,
    });
  }

  // ----- VS Code theme -----

  async detectVscodeTheme(): Promise<{
    name: string;
    themeType: string;
    colors: Record<string, string>;
    tokenColors: unknown[];
  }> {
    return invoke("detect_vscode_theme");
  }

  async setWindowBackgroundColor(
    r: number,
    g: number,
    b: number,
  ): Promise<void> {
    await invoke("set_window_background_color", { r, g, b });
  }

  async openSettingsFile(): Promise<void> {
    await invoke("open_settings_file");
  }

  // ----- Agent -----

  async agentSendMessage(
    repoPath: string,
    message: string,
    requestId: string,
    sessionId?: string,
  ): Promise<AgentResult> {
    return invoke<AgentResult>("agent_send_message", {
      repoPath,
      message,
      requestId,
      sessionId: sessionId ?? null,
    });
  }

  onAgentEvent(
    requestId: string,
    callback: (event: AgentEvent) => void,
  ): () => void {
    return this.listenForEvent(`agent:event:${requestId}`, callback);
  }

  async agentCancel(requestId: string): Promise<void> {
    await invoke("agent_cancel", { requestId });
  }
}
