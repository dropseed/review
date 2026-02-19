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
  GitHubPrRef,
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
  DetectMovePairsResponse,
  ExpandedContext,
  SearchMatch,
  FileSymbol,
  RepoFileSymbols,
  FileSymbolDiff,
  SymbolDefinition,
  RemoteInfo,
  GroupingInput,
  HunkGroup,
  ModifiedSymbolEntry,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
} from "../types";

export interface ApiClient {
  // ----- Git operations -----

  /** Get the current repository path */
  getCurrentRepo(): Promise<string>;

  /** Get the current branch name */
  getCurrentBranch(repoPath: string): Promise<string>;

  /** Get remote info (org/repo name and browse URL) */
  getRemoteInfo(repoPath: string): Promise<RemoteInfo | null>;

  /** Get the default branch (e.g., main or master) */
  getDefaultBranch(repoPath: string): Promise<string>;

  /** List all branches (local and remote) */
  listBranches(repoPath: string): Promise<BranchList>;

  /** Get git status (staged, unstaged, untracked files) */
  getGitStatus(repoPath: string): Promise<GitStatusSummary>;

  /** Get raw git status output */
  getGitStatusRaw(repoPath: string): Promise<string>;

  /** Stage a single file */
  stageFile(repoPath: string, path: string): Promise<void>;

  /** Unstage a single file */
  unstageFile(repoPath: string, path: string): Promise<void>;

  /** Stage all changes */
  stageAll(repoPath: string): Promise<void>;

  /** Unstage all staged changes */
  unstageAll(repoPath: string): Promise<void>;

  /** Stage specific hunks in a file by content hash */
  stageHunks(
    repoPath: string,
    filePath: string,
    contentHashes: string[],
  ): Promise<void>;

  /** Unstage specific hunks in a file by content hash */
  unstageHunks(
    repoPath: string,
    filePath: string,
    contentHashes: string[],
  ): Promise<void>;

  /** Get file content for working tree diff (staged or unstaged) */
  getWorkingTreeFileContent(
    repoPath: string,
    filePath: string,
    cached: boolean,
  ): Promise<FileContent>;

  /** Get lightweight diff statistics (file count, additions, deletions) */
  getDiffShortStat(
    repoPath: string,
    comparison: Comparison,
  ): Promise<DiffShortStat>;

  /** List recent commits */
  listCommits(
    repoPath: string,
    limit?: number,
    branch?: string,
  ): Promise<CommitEntry[]>;

  /** Get detailed information about a specific commit */
  getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail>;

  // ----- GitHub -----

  /** Check if the gh CLI is available and authenticated */
  checkGitHubAvailable(repoPath: string): Promise<boolean>;

  /** List open pull requests for the repository */
  listPullRequests(repoPath: string): Promise<PullRequest[]>;

  // ----- File operations -----

  /** List files that have changes in the comparison */
  listFiles(
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<FileEntry[]>;

  /** List all files in the repository (for file finder) */
  listAllFiles(repoPath: string, comparison: Comparison): Promise<FileEntry[]>;

  /** List contents of a directory (for lazy-loading gitignored directories) */
  listDirectoryContents(
    repoPath: string,
    dirPath: string,
  ): Promise<FileEntry[]>;

  /** Get file content and diff hunks */
  getFileContent(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<FileContent>;

  /** Batch-load all hunks for multiple files in a single call */
  getAllHunks?(
    repoPath: string,
    comparison: Comparison,
    filePaths: string[],
  ): Promise<DiffHunk[]>;

  /** Get expanded context around a range of lines */
  getExpandedContext(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    startLine: number,
    endLine: number,
    githubPr?: GitHubPrRef,
  ): Promise<ExpandedContext>;

  /** Search file contents using git grep */
  searchFileContents(
    repoPath: string,
    query: string,
    caseSensitive: boolean,
    maxResults: number,
  ): Promise<SearchMatch[]>;

  // ----- Review state -----

  /** Load review state for a comparison */
  loadReviewState(
    repoPath: string,
    comparison: Comparison,
  ): Promise<ReviewState>;

  /** Save review state (returns the new version number) */
  saveReviewState(repoPath: string, state: ReviewState): Promise<number>;

  /** List all saved reviews for a repository */
  listSavedReviews(repoPath: string): Promise<ReviewSummary[]>;

  /** Delete a saved review */
  deleteReview(repoPath: string, comparison: Comparison): Promise<void>;

  /** Check whether a review file exists on disk */
  reviewExists(repoPath: string, comparison: Comparison): Promise<boolean>;

  /** Create an empty review file on disk if it doesn't already exist */
  ensureReviewExists(
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<void>;

  /** List all reviews across all registered repos */
  listAllReviewsGlobal(): Promise<GlobalReviewSummary[]>;

  /** Get the central storage path for a repo */
  getReviewStoragePath(repoPath: string): Promise<string>;

  // ----- Classification -----

  /** Classify hunks using static pattern matching (no AI) */
  classifyHunksStatic(hunks: DiffHunk[]): Promise<ClassifyResponse>;

  /** Detect move pairs in hunks */
  detectMovePairs(hunks: DiffHunk[]): Promise<DetectMovePairsResponse>;

  // ----- Grouping -----

  /** Generate logical grouping of hunks using Claude */
  generateGrouping(
    repoPath: string,
    hunks: GroupingInput[],
    options?: { modifiedSymbols?: ModifiedSymbolEntry[] },
  ): Promise<HunkGroup[]>;

  /** Listen for streaming grouping group events (returns unsubscribe fn) */
  onGroupingGroup(callback: (group: HunkGroup) => void): () => void;

  // ----- Trust patterns -----

  /** Get the built-in trust taxonomy */
  getTrustTaxonomy(): Promise<TrustCategory[]>;

  /** Get trust taxonomy including custom patterns from repo */
  getTrustTaxonomyWithCustom(repoPath: string): Promise<TrustCategory[]>;

  /** Check if a label matches a pattern */
  matchTrustPattern(label: string, pattern: string): Promise<boolean>;

  /** Check if a file path should be skipped (build artifacts, etc.) */
  shouldSkipFile(path: string): Promise<boolean>;

  // ----- Symbols -----

  /** Compute symbol-level diffs for files */
  getFileSymbolDiffs(
    repoPath: string,
    filePaths: string[],
    comparison: Comparison,
  ): Promise<FileSymbolDiff[]>;

  /** Find symbol definitions by name across the repo */
  findSymbolDefinitions(
    repoPath: string,
    symbolName: string,
    gitRef?: string,
  ): Promise<SymbolDefinition[]>;

  /** Extract all symbols from a file using tree-sitter */
  getFileSymbols(
    repoPath: string,
    filePath: string,
    gitRef?: string,
  ): Promise<FileSymbol[] | null>;

  /** Extract symbols from all tracked files in the repo */
  getRepoSymbols(repoPath: string): Promise<RepoFileSymbols[]>;

  // ----- File watcher -----

  /** Start watching for file changes in the repo */
  startFileWatcher(repoPath: string): Promise<void>;

  /** Stop watching for file changes */
  stopFileWatcher(repoPath: string): Promise<void>;

  // ----- Events -----

  /** Subscribe to review state change events */
  onReviewStateChanged(callback: (repoPath: string) => void): () => void;

  /** Subscribe to git change events */
  onGitChanged(callback: (repoPath: string) => void): () => void;

  // ----- Window/App -----

  /** Open a new window for a repository */
  openRepoWindow(repoPath: string): Promise<void>;

  /** Batch-check whether each review's diff is still non-empty */
  checkReviewsFreshness(
    reviews: ReviewFreshnessInput[],
  ): Promise<ReviewFreshnessResult[]>;

  /** Check if a path is a git repository */
  isGitRepo(path: string): Promise<boolean>;

  // ----- VS Code theme -----

  /** Detect the active VS Code theme (reads settings + extension theme files) */
  detectVscodeTheme(): Promise<{
    name: string;
    themeType: string;
    colors: Record<string, string>;
    tokenColors: unknown[];
  }>;

  /** Set the window background color (affects title bar on macOS) */
  setWindowBackgroundColor(r: number, g: number, b: number): Promise<void>;

  /** Open the settings.json file in the system editor */
  openSettingsFile(): Promise<void>;
}

/**
 * Type guard to check if we're in a Tauri environment.
 * Returns false if running with the mock (browser mode).
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  if (!("__TAURI_INTERNALS__" in window)) return false;

  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { __isMock?: boolean } }
  ).__TAURI_INTERNALS__;
  return internals?.__isMock !== true;
}
