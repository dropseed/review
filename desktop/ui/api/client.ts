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
  CommitOutputLine,
  CommitResult,
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
  LspServerStatus,
  RemoteInfo,
  GroupingInput,
  HunkGroup,
  GroupingEvent,
  ModifiedSymbolEntry,
  RepoLocalActivity,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
  WorktreeInfo,
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
    range?: string,
  ): Promise<CommitEntry[]>;

  /** Get detailed information about a specific commit */
  getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail>;

  // ----- GitHub -----

  /** Check if the gh CLI is available and authenticated */
  checkGitHubAvailable(repoPath: string): Promise<boolean>;

  /** List open pull requests for the repository */
  listPullRequests(repoPath: string): Promise<PullRequest[]>;

  // ----- Worktree operations -----

  /** Create a review-managed worktree for the given git ref */
  createReviewWorktree(
    repoPath: string,
    name: string,
    gitRef: string,
  ): Promise<WorktreeInfo>;

  /** Remove a review-managed worktree */
  removeReviewWorktree(repoPath: string, worktreePath: string): Promise<void>;

  /** Resolve a git ref to a commit SHA */
  resolveRef(repoPath: string, gitRef: string): Promise<string>;

  /** Check if a worktree has uncommitted changes */
  hasWorktreeChanges(repoPath: string, worktreePath: string): Promise<boolean>;

  /** Update a worktree's HEAD to a new commit SHA */
  updateWorktreeHead(
    repoPath: string,
    worktreePath: string,
    commitSha: string,
  ): Promise<void>;

  // ----- File operations -----

  /** List files that have changes in the comparison */
  listFiles(
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ): Promise<FileEntry[]>;

  /** List all files in the repository (for file finder) */
  listAllFiles(repoPath: string, comparison: Comparison): Promise<FileEntry[]>;

  /** List all tracked files in the repository (no comparison needed, for browse mode) */
  listRepoFiles(repoPath: string): Promise<FileEntry[]>;

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

  /** Get the central storage root (~/.review/) */
  getReviewRoot(): Promise<string>;

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
    options?: { modifiedSymbols?: ModifiedSymbolEntry[]; requestId?: string },
  ): Promise<HunkGroup[]>;

  /** Listen for streaming grouping events (returns unsubscribe fn) */
  onGroupingEvent(
    requestId: string,
    callback: (event: GroupingEvent) => void,
  ): () => void;

  /** Cancel an in-flight grouping generation by request ID */
  cancelGrouping(requestId: string): Promise<void>;

  // ----- Commit -----

  /** Create a git commit with streaming pre-commit output */
  gitCommit(
    repoPath: string,
    message: string,
    requestId: string,
  ): Promise<CommitResult>;

  /** Listen for streaming commit output lines (returns unsubscribe fn) */
  onCommitOutput(
    requestId: string,
    callback: (line: CommitOutputLine) => void,
  ): () => void;

  // ----- Commit message generation -----

  /** Generate a commit message from the staged diff using Claude */
  generateCommitMessage(repoPath: string, requestId: string): Promise<string>;

  /** Listen for streaming commit message text chunks (returns unsubscribe fn) */
  onCommitMessageChunk(
    requestId: string,
    callback: (chunk: string) => void,
  ): () => void;

  // ----- Trust patterns -----

  /** Get the built-in trust taxonomy */
  getTrustTaxonomy(): Promise<TrustCategory[]>;

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

  // ----- Local activity -----

  /** List all local branch activity across registered repos */
  listAllLocalActivity(): Promise<RepoLocalActivity[]>;

  /** Register a repo in the central index (returns true if valid git repo) */
  registerRepo(repoPath: string): Promise<boolean>;

  /** Unregister a repo from the central index */
  unregisterRepo(repoPath: string): Promise<void>;

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

  /** Subscribe to local activity change events (branch added/deleted in any repo) */
  onLocalActivityChanged(callback: (repoPath: string) => void): () => void;

  // ----- Window/App -----

  /** Consume a pending CLI open request (cold start from `review` CLI) */
  consumeCliRequest(): Promise<{
    repoPath: string;
    comparisonKey: string | null;
    focusedFile: string | null;
  } | null>;

  /** Open a new window for a repository */
  openRepoWindow(repoPath: string): Promise<void>;

  /** Batch-check whether each review's diff is still non-empty */
  checkReviewsFreshness(
    reviews: ReviewFreshnessInput[],
  ): Promise<ReviewFreshnessResult[]>;

  /** Check if a path is a git repository */
  isGitRepo(path: string): Promise<boolean>;

  /** Check if a path is a file (not a directory) */
  pathIsFile(path: string): Promise<boolean>;

  /** Read a raw file from disk (no git needed, for standalone file viewing) */
  readRawFile(path: string): Promise<FileContent>;

  /** Get raw file content at HEAD from a git repo (no diff, browse mode) */
  getFileRawContent(repoPath: string, filePath: string): Promise<FileContent>;

  /** List files in a plain directory (no git needed, for Layer 0 browsing) */
  listDirectoryPlain(dirPath: string): Promise<FileEntry[]>;

  // ----- LSP -----

  /** Auto-discover and start all relevant LSP servers for a repo */
  initLspServers(repoPath: string): Promise<LspServerStatus[]>;

  /** Stop all LSP servers for a repo */
  stopAllLspServers(repoPath: string): Promise<void>;

  /** Restart a specific LSP server by language */
  restartLspServer(
    repoPath: string,
    language: string,
  ): Promise<LspServerStatus>;

  /** Discover available LSP servers for a repo (without starting them) */
  discoverLspServers(repoPath: string): Promise<LspServerStatus[]>;

  /** Go to definition via LSP */
  lspGotoDefinition(
    repoPath: string,
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolDefinition[]>;

  /** Get hover info via LSP */
  lspHover(
    repoPath: string,
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null>;

  /** Find references via LSP */
  lspFindReferences(
    repoPath: string,
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolDefinition[]>;

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

  /** Resolve a route prefix (e.g., "owner/repo") to a local filesystem path */
  resolveRepoPath?(routePrefix: string): Promise<string | null>;
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
