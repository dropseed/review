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
  FileSymbolDiff,
  RemoteInfo,
} from "./types";

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

  async saveReviewState(repoPath: string, state: ReviewState): Promise<void> {
    await invoke("save_review_state", { repoPath, state });
  }

  async listSavedReviews(repoPath: string): Promise<ReviewSummary[]> {
    return invoke<ReviewSummary[]>("list_saved_reviews", { repoPath });
  }

  async deleteReview(repoPath: string, comparison: Comparison): Promise<void> {
    await invoke("delete_review", { repoPath, comparison });
  }

  async getCurrentComparison(repoPath: string): Promise<Comparison | null> {
    return invoke<Comparison | null>("get_current_comparison", { repoPath });
  }

  async setCurrentComparison(
    repoPath: string,
    comparison: Comparison,
  ): Promise<void> {
    await invoke("set_current_comparison", { repoPath, comparison });
  }

  // ----- Classification -----

  async checkClaudeAvailable(): Promise<boolean> {
    return invoke<boolean>("check_claude_available");
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

  // ----- File watcher -----

  async startFileWatcher(repoPath: string): Promise<void> {
    await invoke("start_file_watcher", { repoPath });
  }

  async stopFileWatcher(repoPath: string): Promise<void> {
    await invoke("stop_file_watcher", { repoPath });
  }

  // ----- Events -----

  onClassifyProgress(callback: (completedIds: string[]) => void): () => void {
    let unlisten: UnlistenFn | null = null;

    listen<string[]>("classify:batch-complete", (event) => {
      callback(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error("Failed to listen for classify progress:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }

  onReviewStateChanged(callback: (repoPath: string) => void): () => void {
    let unlisten: UnlistenFn | null = null;

    listen<string>("review-state-changed", (event) => {
      callback(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error("Failed to listen for review state changes:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }

  onGitChanged(callback: (repoPath: string) => void): () => void {
    let unlisten: UnlistenFn | null = null;

    listen<string>("git-changed", (event) => {
      callback(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error("Failed to listen for git changes:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }

  // ----- Window/App -----

  async openRepoWindow(repoPath: string): Promise<void> {
    await invoke("open_repo_window", { repoPath });
  }
}
