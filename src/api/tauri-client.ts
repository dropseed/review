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
  GitStatusSummary,
  Comparison,
  PullRequest,
  CommitEntry,
  CommitDetail,
  FileEntry,
  FileContent,
  ReviewState,
  ReviewSummary,
  GlobalReviewSummary,
  TrustCategory,
  DiffHunk,
  DiffShortStat,
  ClassifyResponse,
  HunkInput,
  ClassifyOptions,
  DetectMovePairsResponse,
  ExpandedContext,
  SearchMatch,
  FileSymbol,
  FileSymbolDiff,
  SymbolDefinition,
  RemoteInfo,
  GroupingInput,
  HunkGroup,
  ModifiedSymbolEntry,
  SummaryInput,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
} from "../types";

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
  ): Promise<CommitEntry[]> {
    return invoke<CommitEntry[]>("list_commits", { repoPath, limit, branch });
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

  // ----- File operations -----

  async listFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_files", { repoPath, comparison });
  }

  async listAllFiles(
    repoPath: string,
    comparison: Comparison,
  ): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_all_files", { repoPath, comparison });
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
  ): Promise<FileContent> {
    return invoke<FileContent>("get_file_content", {
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
  ): Promise<ExpandedContext> {
    return invoke<ExpandedContext>("get_expanded_context", {
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

  async deleteReview(repoPath: string, comparison: Comparison): Promise<void> {
    await invoke("delete_review", { repoPath, comparison });
  }

  async ensureReviewExists(
    repoPath: string,
    comparison: Comparison,
  ): Promise<void> {
    await invoke("ensure_review_exists", { repoPath, comparison });
  }

  async listAllReviewsGlobal(): Promise<GlobalReviewSummary[]> {
    return invoke<GlobalReviewSummary[]>("list_all_reviews_global");
  }

  async getReviewStoragePath(repoPath: string): Promise<string> {
    return invoke<string>("get_review_storage_path", { repoPath });
  }

  // ----- Classification -----

  async checkClaudeAvailable(): Promise<boolean> {
    return invoke<boolean>("check_claude_available");
  }

  async classifyHunksStatic(hunks: DiffHunk[]): Promise<ClassifyResponse> {
    return invoke<ClassifyResponse>("classify_hunks_static", { hunks });
  }

  async classifyHunks(
    repoPath: string,
    hunks: HunkInput[],
    options?: ClassifyOptions,
  ): Promise<ClassifyResponse> {
    return invoke<ClassifyResponse>("classify_hunks_with_claude", {
      repoPath,
      hunks,
      command: options?.command,
      batchSize: options?.batchSize,
      maxConcurrent: options?.maxConcurrent,
    });
  }

  async detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse> {
    return invoke<DetectMovePairsResponse>("detect_hunks_move_pairs", {
      hunks,
    });
  }

  // ----- Grouping -----

  async generateGrouping(
    repoPath: string,
    hunks: GroupingInput[],
    options?: { command?: string; modifiedSymbols?: ModifiedSymbolEntry[] },
  ): Promise<HunkGroup[]> {
    return invoke<HunkGroup[]>("generate_hunk_grouping", {
      repoPath,
      hunks,
      command: options?.command,
      modifiedSymbols: options?.modifiedSymbols,
    });
  }

  // ----- Summary -----

  async generateSummary(
    repoPath: string,
    hunks: SummaryInput[],
    options?: { command?: string },
  ): Promise<{ title: string; summary: string }> {
    return invoke<{ title: string; summary: string }>(
      "generate_review_summary",
      {
        repoPath,
        hunks,
        command: options?.command,
      },
    );
  }

  async generateDiagram(
    repoPath: string,
    hunks: SummaryInput[],
    options?: { command?: string },
  ): Promise<string | null> {
    return invoke<string | null>("generate_review_diagram", {
      repoPath,
      hunks,
      command: options?.command,
    });
  }

  // ----- Trust patterns -----

  async getTrustTaxonomy(): Promise<TrustCategory[]> {
    return invoke<TrustCategory[]>("get_trust_taxonomy");
  }

  async getTrustTaxonomyWithCustom(repoPath: string): Promise<TrustCategory[]> {
    return invoke<TrustCategory[]>("get_trust_taxonomy_with_custom", {
      repoPath,
    });
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
  ): Promise<SymbolDefinition[]> {
    return invoke<SymbolDefinition[]>("find_symbol_definitions", {
      repoPath,
      symbolName,
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

  onClassifyProgress(callback: (completedIds: string[]) => void): () => void {
    return this.listenForEvent("classify:batch-complete", callback);
  }

  onReviewStateChanged(callback: (repoPath: string) => void): () => void {
    return this.listenForEvent("review-state-changed", callback);
  }

  onGitChanged(callback: (repoPath: string) => void): () => void {
    return this.listenForEvent("git-changed", callback);
  }

  // ----- Window/App -----

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
}
