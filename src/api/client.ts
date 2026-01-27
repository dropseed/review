/**
 * API Client Interface
 *
 * Defines all backend operations that can be implemented by different backends:
 * - TauriClient: Desktop app using Tauri IPC
 * - HttpClient: Web/test using HTTP API
 */

import type {
  BranchList,
  GitStatusSummary,
  Comparison,
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
} from "./types";

export interface ApiClient {
  // ----- Git operations -----

  /** Get the current repository path */
  getCurrentRepo(): Promise<string>;

  /** Get the current branch name */
  getCurrentBranch(repoPath: string): Promise<string>;

  /** Get the default branch (e.g., main or master) */
  getDefaultBranch(repoPath: string): Promise<string>;

  /** List all branches (local and remote) */
  listBranches(repoPath: string): Promise<BranchList>;

  /** Get git status (staged, unstaged, untracked files) */
  getGitStatus(repoPath: string): Promise<GitStatusSummary>;

  /** Get raw git status output */
  getGitStatusRaw(repoPath: string): Promise<string>;

  // ----- File operations -----

  /** List files that have changes in the comparison */
  listFiles(repoPath: string, comparison: Comparison): Promise<FileEntry[]>;

  /** List all files in the repository (for file finder) */
  listAllFiles(repoPath: string, comparison: Comparison): Promise<FileEntry[]>;

  /** Get file content and diff hunks */
  getFileContent(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
  ): Promise<FileContent>;

  /** Get expanded context around a range of lines */
  getExpandedContext(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    startLine: number,
    endLine: number,
  ): Promise<ExpandedContext>;

  // ----- Review state -----

  /** Load review state for a comparison */
  loadReviewState(
    repoPath: string,
    comparison: Comparison,
  ): Promise<ReviewState>;

  /** Save review state */
  saveReviewState(repoPath: string, state: ReviewState): Promise<void>;

  /** List all saved reviews for a repository */
  listSavedReviews(repoPath: string): Promise<ReviewSummary[]>;

  /** Delete a saved review */
  deleteReview(repoPath: string, comparison: Comparison): Promise<void>;

  /** Get the current (last active) comparison for a repo */
  getCurrentComparison(repoPath: string): Promise<Comparison | null>;

  /** Set the current comparison */
  setCurrentComparison(repoPath: string, comparison: Comparison): Promise<void>;

  // ----- Classification -----

  /** Check if Claude CLI is available */
  checkClaudeAvailable(): Promise<boolean>;

  /** Classify hunks using Claude */
  classifyHunks(
    repoPath: string,
    hunks: HunkInput[],
    options?: ClassifyOptions,
  ): Promise<ClassifyResponse>;

  /** Detect move pairs in hunks */
  detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse>;

  // ----- Trust patterns -----

  /** Get the built-in trust taxonomy */
  getTrustTaxonomy(): Promise<TrustCategory[]>;

  /** Get trust taxonomy including custom patterns from repo */
  getTrustTaxonomyWithCustom(repoPath: string): Promise<TrustCategory[]>;

  /** Check if a label matches a pattern */
  matchTrustPattern(label: string, pattern: string): Promise<boolean>;

  // ----- File watcher -----

  /** Start watching for file changes in the repo */
  startFileWatcher(repoPath: string): Promise<void>;

  /** Stop watching for file changes */
  stopFileWatcher(repoPath: string): Promise<void>;

  // ----- Events -----

  /** Subscribe to classification progress events */
  onClassifyProgress(callback: (completedIds: string[]) => void): () => void;

  /** Subscribe to review state change events */
  onReviewStateChanged(callback: (repoPath: string) => void): () => void;

  /** Subscribe to git change events */
  onGitChanged(callback: (repoPath: string) => void): () => void;

  // ----- Window/App -----

  /** Open a new window for a repository */
  openRepoWindow(repoPath: string): Promise<void>;
}

/**
 * Type guard to check if we're in a Tauri environment.
 * Returns false if running with the mock (browser mode).
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  if (!("__TAURI_INTERNALS__" in window)) return false;
  // Check if it's the mock (browser mode)
  const internals = (window as Record<string, unknown>).__TAURI_INTERNALS__ as
    | Record<string, unknown>
    | undefined;
  return internals?.__isMock !== true;
}
