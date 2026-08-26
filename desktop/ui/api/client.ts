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
  AgentUsage,
  ReviewTierInfo,
  PullRequest,
  ViewerPrSnapshot,
  CommitEntry,
  CommitComparison,
  CommitDetail,
  HunkAttribution,
  CommitOutputLine,
  CommitResult,
  FileEntry,
  FileContent,
  FilesDelta,
  MovePair,
  ReviewState,
  ReviewLoadResult,
  ResolvedReview,
  ReviewSummary,
  GlobalReviewSummary,
  TrustCategory,
  DiffHunk,
  DiffShortStat,
  ClassifyResponse,
  ExpandedContext,
  SearchMatch,
  FileSymbol,
  RepoFileSymbols,
  FileSymbolDiff,
  SymbolDefinition,
  LspServerStatus,
  RemoteInfo,
  RepoLocalActivity,
  ReviewFreshnessInput,
  ReviewFreshnessResult,
  Workspace,
  RouteLanding,
  Attachment,
  WorktreeInfo,
  WorktreeCheckout,
  RepoWorktrees,
  TerminalSessionInfo,
  TerminalStarted,
  TerminalStatus,
  TerminalOutput,
  TerminalExit,
  TerminalResized,
  TerminalReplay,
  TerminalWorkspaceAssigned,
  TerminalRemoved,
} from "../types";

/**
 * Payload emitted with the `git-changed` watcher event. Carries the set of
 * repo-relative working-tree paths that changed in the debounce window so the
 * frontend can refresh only those files.
 */
export interface GitChangedPayload {
  repoPath: string;
  /**
   * Repo-relative paths whose working-tree content changed. Empty when only
   * git-internal state changed (branch switch, commit, stage/unstage).
   */
  changedPaths: string[];
  /**
   * True if `.git/HEAD`, `.git/refs/heads/`, or `.git/index` changed — signals
   * that a full refresh is warranted (branch switch, commit, stage).
   */
  gitStateChanged: boolean;
}

/** Payload emitted with the `git-index-lock` watcher event. */
export interface GitIndexLockPayload {
  repoPath: string;
  /** Whether `.git/index.lock` is held right now. */
  locked: boolean;
}

/** Payload emitted with the `repo-activity-changed` watcher event. */
export interface RepoActivityChangedPayload {
  repoPath: string;
  activity: RepoLocalActivity;
}

/** What starting a terminal takes, on either transport. */
export interface TerminalStartParams {
  terminalId: string;
  repoPath: string;
  cwd: string;
  cols: number;
  rows: number;
  shell?: string;
  /**
   * The workspace to be born in, when the caller knows which one — the stage's
   * own "+". Omitted, the backend routes by cwd. Naming it here rather than
   * reassigning afterwards is what keeps the workspace and the session
   * together.
   */
  workspaceId?: string;
}

/**
 * That, as either wire wants it.
 *
 * Shared because the two clients used to enumerate these fields separately and
 * quietly disagreed: the web client never sent `workspaceId`, so every terminal
 * started from a phone was routed by its cwd instead of landing in the
 * workspace on screen — and nothing could catch it, since an absent hint is a
 * *valid* request that simply means "you decide". An optional field left out of
 * one payload is the one drift a shared builder makes impossible.
 *
 * Optionals go as explicit `null` rather than being dropped: Tauri's argument
 * deserialization wants the key present, and it costs the HTTP side nothing.
 */
export function terminalStartPayload(
  params: TerminalStartParams,
): Record<string, unknown> {
  return {
    terminalId: params.terminalId,
    repoPath: params.repoPath,
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    shell: params.shell ?? null,
    workspaceId: params.workspaceId ?? null,
  };
}

export interface ApiClient {
  // ----- Git operations -----

  /** Get the current repository path */
  getCurrentRepo(): Promise<string>;

  /** Get the current branch name */
  getCurrentBranch(repoPath: string): Promise<string>;

  /** Get `git config user.name` (null if unset). Used as the default annotation author. */
  getGitUser(repoPath: string): Promise<string | null>;

  /** Get remote info (org/repo name and browse URL) */
  getRemoteInfo(repoPath: string): Promise<RemoteInfo | null>;

  /** Run `git fetch --prune origin` for the repo. */
  fetchOrigin(repoPath: string): Promise<void>;

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

  /**
   * Resolve a commit into the comparison that shows it — `parent..sha`, taking
   * a merge's first parent and the empty tree for a root commit.
   */
  getCommitComparison(
    repoPath: string,
    gitRef: string,
  ): Promise<CommitComparison>;

  /** Attribute a comparison's net-diff hunks to the commits that introduced them */
  getHunkAttribution(
    repoPath: string,
    base: string,
    head: string,
  ): Promise<HunkAttribution>;

  // ----- GitHub -----

  /** Check if the gh CLI is available and authenticated */
  checkGitHubAvailable(repoPath: string): Promise<boolean>;

  /** List open pull requests for the repository */
  listPullRequests(repoPath: string): Promise<PullRequest[]>;

  /**
   * Every open PR the user has out, account-wide, joined to registered repos.
   * `refresh` queries GitHub; without it this reads the cached snapshot, which
   * is what the sidebar paints with before gh has answered.
   */
  getViewerPrs(refresh: boolean): Promise<ViewerPrSnapshot>;

  // ----- Review tiers -----

  /** How much of a review is present locally: listed, fetched, or materialized */
  getReviewTier(repoPath: string, ref: string): Promise<ReviewTierInfo>;

  /**
   * Rate-limit usage for the coding agents installed on this machine.
   * `force` bypasses the service-side cache, for an explicit user refresh.
   */
  getAgentUsage(force?: boolean): Promise<AgentUsage[]>;

  /** Listed -> Fetched: pull a PR's head (and base) so its diff reads locally */
  fetchPullRequest(repoPath: string, pr: GitHubPrRef): Promise<string>;

  /** Fetched -> Materialized: provision a worktree. Returns its path. */
  materializeReview(repoPath: string, ref: string): Promise<string>;

  /** Materialized -> Fetched: drop the worktree, keep the review record */
  releaseReviewWorktree(repoPath: string, ref: string): Promise<void>;

  /** Reclaim worktrees and fetched refs whose PR has merged or closed */
  reclaimClosedPrs(repoPath: string): Promise<string[]>;

  // ----- Worktree operations -----

  /** Create a review-managed worktree for the given git ref */
  createReviewWorktree(
    repoPath: string,
    name: string,
    gitRef: string,
  ): Promise<WorktreeInfo>;

  /** Remove a review-managed worktree */
  removeReviewWorktree(repoPath: string, worktreePath: string): Promise<void>;

  /**
   * Every named repo's worktrees, each with its dirty flag. Batched: the picker
   * asks about every repo it lists at once.
   */
  listWorktreeStatus(repoPaths: string[]): Promise<RepoWorktrees[]>;

  /**
   * Give a branch a worktree, creating the branch at HEAD if git doesn't know
   * it. A branch that already has a checkout is answered with that one
   * (`created: false`) rather than refused.
   */
  createWorktree(repoPath: string, branch: string): Promise<WorktreeCheckout>;

  /**
   * Remove a worktree. Rejects the main checkout, a path that isn't one of this
   * repo's worktrees, and anything holding uncommitted work — there is no force.
   */
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;

  /** Resolve a git ref to a commit SHA */
  resolveRef(repoPath: string, gitRef: string): Promise<string>;

  /** Update a worktree's HEAD to a new commit SHA */
  updateWorktreeHead(
    repoPath: string,
    worktreePath: string,
    commitSha: string,
  ): Promise<void>;

  // ----- File operations -----

  /** List files that have changes in the comparison */
  listFiles(repoPath: string, comparison: Comparison): Promise<FileEntry[]>;

  /** List all files in the repository (for file finder) */
  listAllFiles(repoPath: string, comparison: Comparison): Promise<FileEntry[]>;

  /** List all tracked files in the repository (no comparison needed, for browse mode) */
  listRepoFiles(repoPath: string): Promise<FileEntry[]>;

  /** List the repository's files as of a ref. Read-only — nothing is checked out. */
  listFilesAtRef(repoPath: string, gitRef: string): Promise<FileEntry[]>;

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
  ): Promise<FileContent>;

  /** Batch-load all hunks for multiple files in a single call */
  getAllHunks?(
    repoPath: string,
    comparison: Comparison,
    filePaths: string[],
  ): Promise<DiffHunk[]>;

  /**
   * Recompute only the named files of the comparison.
   *
   * The file watcher's path: an edit names the paths it touched, and this
   * returns their current hunks plus enough file-list identity to place them
   * in (or drop them from) a diff the caller already holds. Hunks are
   * identical to what `getAllHunks` would return for those files.
   */
  getFilesDelta(
    repoPath: string,
    comparison: Comparison,
    filePaths: string[],
  ): Promise<FilesDelta>;

  /** Get expanded context around a range of lines */
  getExpandedContext(
    repoPath: string,
    filePath: string,
    comparison: Comparison,
    startLine: number,
    endLine: number,
  ): Promise<ExpandedContext>;

  /** Search file contents using git grep */
  searchFileContents(
    repoPath: string,
    query: string,
    caseSensitive: boolean,
    maxResults: number,
  ): Promise<SearchMatch[]>;

  // ----- Review state -----

  /**
   * Resolve a review's `ref` (+ optional base override) into a ResolvedReview
   * (identity + concrete Comparison). The ref is a branch name, SHA, tag,
   * or "stash@{N}".
   */
  resolveReview(
    repoPath: string,
    ref: string,
    baseOverride?: string,
  ): Promise<ResolvedReview>;

  /** Load persisted review state for a ref (no reconciliation) */
  loadReviewState(repoPath: string, ref: string): Promise<ReviewState>;

  /**
   * Carry persisted decisions forward onto the live diff `hunks` (already loaded
   * for display), returning the reconciled state and how many were carried.
   * In-memory only — persisted on the next save.
   */
  reconcileReviewState(
    state: ReviewState,
    hunks: DiffHunk[],
  ): Promise<ReviewLoadResult>;

  /**
   * Save review state (returns the new version number). Pass the live diff
   * `hunks` so the save reconciles decisions across hunk-ID drift; omit them
   * when no diff is in hand (e.g. a worktree-path-only save).
   */
  saveReviewState(
    repoPath: string,
    state: ReviewState,
    hunks?: DiffHunk[],
  ): Promise<number>;

  /** List all saved reviews for a repository */
  listSavedReviews(repoPath: string): Promise<ReviewSummary[]>;

  /**
   * Set (or clear, when null) a review's base override in place — no re-key —
   * and return the re-resolved review so the UI can refresh its diff.
   */
  setBaseOverride(
    repoPath: string,
    ref: string,
    baseOverride: string | null,
  ): Promise<ResolvedReview>;

  /** Delete a saved review */
  deleteReview(repoPath: string, ref: string): Promise<void>;

  /** Check whether a review file exists on disk */
  reviewExists(repoPath: string, ref: string): Promise<boolean>;

  /** Create an empty review file on disk if it doesn't already exist */
  ensureReviewExists(
    repoPath: string,
    ref: string,
    baseOverride?: string,
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
  /**
   * The comparison's move pairs, detected from the diff on disk.
   *
   * Takes the comparison rather than the hunks: a move is a cross-file fact so
   * the whole diff has to be examined either way, and shipping several hundred
   * files of hunks across the boundary to learn a handful of id pairs is the
   * expensive way to ask. Callers annotate the hunks they already hold.
   */
  getComparisonMovePairs(
    repoPath: string,
    comparison: Comparison,
  ): Promise<MovePair[]>;

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

  // ----- Work items -----
  //
  // Every mutation returns the full list rather than a delta: list order is
  // priority order, so a reorder or a removal changes entries the caller never
  // named, and the canonical list is the only answer that can't drift. The
  // caller reconciles against it instead of replaying its own optimistic edit,
  // which keeps it correct when a `review workspace` command or another window wrote
  // in between. Both transports and the two Rust backends follow this; they
  // don't restate it.

  /**
   * List work items in priority order.
   *
   * `focused` is the workspace on screen. The desktop backend cleans up dead
   * router-made workspaces on this read, and a workspace being *looked at* is
   * in use even with nothing running in it — see `in_use` in `commands.rs`.
   */
  listWorkspaces(focused?: string | null): Promise<Workspace[]>;

  /** Create a workspace. A null title leaves it deriving its own. */
  addWorkspace(
    title: string | null,
    attachments: Attachment[],
  ): Promise<Workspace[]>;

  /**
   * Delete a work item.
   *
   * `recursive` takes everything nested under it too. Left off, the
   * sub-workspaces come up to its level and stay in the queue — the safe
   * reading, and the only one a caller with nobody to ask may use.
   */
  removeWorkspace(id: string, recursive?: boolean): Promise<Workspace[]>;

  /**
   * Move a work item to a 0-based row in the queue, taking everything nested
   * under it.
   *
   * The destination decides the depth: it lands as a sibling of the row it
   * displaces, and at the end of the list — where there is no such row — at the
   * top level. `reorderWorkspaces` in the store mirrors this so the optimistic
   * list matches what comes back.
   *
   * `keepParent` asks the other question — reorder among the siblings, leaving
   * the nesting alone — which is what a menu verb aimed at position means.
   */
  moveWorkspace(
    id: string,
    position: number,
    keepParent?: boolean,
  ): Promise<Workspace[]>;

  /**
   * Put a workspace under another, or — with a null `parentId` — back at the
   * top level. Rejected when the new parent is the workspace itself or sits
   * beneath it, which is the only impossible nesting.
   */
  nestWorkspace(id: string, parentId: string | null): Promise<Workspace[]>;

  /**
   * Show a repo in a workspace — opening a repo tab.
   *
   * Cannot fail on a conflict: attachments are non-exclusive. A path the
   * workspace already shows keeps its one tab and takes the new ref hint.
   */
  attachWorkspace(
    id: string,
    path: string,
    refName?: string | null,
  ): Promise<Workspace[]>;

  /** Stop showing a repo — closing a repo tab. A no-op if it isn't attached. */
  detachWorkspace(id: string, path: string): Promise<Workspace[]>;

  /** Rename a work item. Null (or empty) clears it back to the derived title. */
  renameWorkspace(id: string, title: string | null): Promise<Workspace[]>;

  /**
   * Route a repo+branch to its workspace and commit that — what ⌘K's Enter
   * does.
   *
   * The palette previews this decision client-side (`previewRoute`) so it costs
   * nothing per keystroke; this is the call that makes the preview true. It
   * never writes attachments — that is `attachWorkspace`'s job alone.
   */
  routeWorkspace(
    repoPath: string,
    ref: string,
    workspaceId?: string,
  ): Promise<RouteLanding>;

  /** Subscribe to external changes to ~/.review/work.json (returns unsubscribe fn) */
  onWorkChanged(callback: () => void): () => void;

  // ----- File watcher -----

  /** Start watching for file changes in the repo */
  startFileWatcher(repoPath: string): Promise<void>;

  /** Stop watching for file changes */
  stopFileWatcher(repoPath: string): Promise<void>;

  // ----- Events -----

  /** Subscribe to review state change events */
  onReviewStateChanged(callback: (repoPath: string) => void): () => void;

  /** Subscribe to git change events */
  onGitChanged(callback: (payload: GitChangedPayload) => void): () => void;

  /**
   * Subscribe to `.git/index.lock` transitions — some git process started or
   * finished writing the index. Separate from `onGitChanged` on purpose: this
   * says "don't touch the repo", not "re-read it".
   */
  onGitIndexLock(callback: (payload: GitIndexLockPayload) => void): () => void;

  /** Subscribe to scoped activity deltas for a single repo. */
  onRepoActivityChanged(
    callback: (payload: RepoActivityChangedPayload) => void,
  ): () => void;

  // ----- Window/App -----

  /** Consume a pending CLI open request (cold start from `review` CLI) */
  consumeCliRequest(): Promise<{
    repoPath: string;
    ref: string | null;
    focusedFile: string | null;
    focusedHunkHash: string | null;
  } | null>;

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

  /** Get a file's content as of a ref. Carries no hunks — at a ref there is
   *  nothing to compare against. */
  getFileContentAtRef(
    repoPath: string,
    filePath: string,
    gitRef: string,
  ): Promise<FileContent>;

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

  // ----- Terminals -----

  /**
   * Whether the current backend can host terminal sessions. Tauri returns true;
   * web mode returns false until the WebSocket transport lands. Gates the whole
   * terminal UI (panel toggle, badges).
   */
  terminalsAvailable(): Promise<boolean>;

  /**
   * Start a new terminal session. `terminalId` is client-generated
   * (`crypto.randomUUID()`) so the caller can subscribe to its events BEFORE
   * the session exists.
   *
   * The backend routes it: every session is born in the workspace its cwd
   * belongs to, and the answer comes back with the session because the caller
   * has to know where to draw it — and whether that workspace is one the queue
   * has never listed.
   */
  terminalStart(params: TerminalStartParams): Promise<TerminalStarted>;

  /**
   * Move a session into a workspace — what dragging a terminal onto a card
   * does. Attribution lives on the session, so this is the only way it changes.
   */
  terminalAssignWorkspace(
    terminalId: string,
    workspaceId: string | null,
  ): Promise<void>;

  /** Write UTF-8 input (keystrokes) to a session's PTY. */
  terminalWrite(terminalId: string, data: string): Promise<void>;

  /** Resize a session's PTY. */
  terminalResize(terminalId: string, cols: number, rows: number): Promise<void>;

  /** Kill a session (child + PTY teardown). */
  terminalKill(terminalId: string): Promise<void>;

  /** List live sessions, optionally scoped to a repo path. */
  terminalList(repoPath?: string): Promise<TerminalSessionInfo[]>;

  /**
   * Kill every live session across every repo/window at once (governance
   * action for the "background sessions" list) — the daemon itself keeps
   * running, only its sessions are torn down.
   */
  terminalShutdownAllBackground(): Promise<void>;

  /**
   * Fetch the scrollback ring buffer (raw bytes, base64) plus current status,
   * for replaying into a fresh xterm instance on reattach (new window, web
   * reload).
   */
  terminalReplay(terminalId: string): Promise<TerminalReplay>;

  /**
   * Peek several sessions in one round trip, keyed by id.
   *
   * The overview draws a card per running terminal and each card wants the
   * current screen, so asking one at a time made the poll's cost the *number of
   * terminals* — N sockets, N VT renders, N store writes, every couple of
   * seconds. Ids the daemon doesn't know are omitted from the answer rather
   * than failing it: a session that died between the ask and the answer is a
   * normal race, not an error.
   */
  terminalPeekMany(terminalIds: string[]): Promise<Record<string, string>>;

  /** Subscribe to raw PTY output for a session (returns unsubscribe fn). */
  onTerminalOutput(
    terminalId: string,
    callback: (output: TerminalOutput) => void,
  ): () => void;

  /**
   * Subscribe to the status roll-up — status changes for ANY session, and the
   * one route status takes. A mounted pane is not a special case of it: the
   * announcement channel carries every session's status whether or not this
   * window is drawing it, so there is nothing a per-session subscription would
   * have added.
   */
  onTerminalStatusChanged(
    callback: (status: TerminalStatus) => void,
  ): () => void;

  /**
   * Subscribe to a session's PTY-resized event (returns unsubscribe fn). Fires
   * for every size change, whichever client asked for it — the shared grid is
   * the daemon's, and a pane rendering at a stale size draws garbage.
   */
  onTerminalResized(
    terminalId: string,
    callback: (resized: TerminalResized) => void,
  ): () => void;

  /** Subscribe to a session's exit event (returns unsubscribe fn). */
  onTerminalExit(
    terminalId: string,
    callback: (exit: TerminalExit) => void,
  ): () => void;

  /**
   * Subscribe to sessions being *born*, anywhere — the phone's PWA, `review
   * terminal start`, another window. There is no id to subscribe to yet when a
   * session is created elsewhere, which is why this is global and why the app
   * used to discover them only by re-listing.
   */
  onTerminalStarted(
    callback: (session: TerminalSessionInfo) => void,
  ): () => void;

  /**
   * The global exit roll-up: `onTerminalExit` for sessions this window never
   * subscribed to. A shell that finished while its card sat in the queue
   * unopened is exactly the one a person wants marked done.
   */
  onTerminalExited(callback: (exit: TerminalExit) => void): () => void;

  /** Subscribe to sessions changing workspace, whichever client moved them. */
  onTerminalWorkspaceAssigned(
    callback: (assignment: TerminalWorkspaceAssigned) => void,
  ): () => void;

  /** Subscribe to sessions the daemon has stopped listing. */
  onTerminalRemoved(callback: (removal: TerminalRemoved) => void): () => void;

  /**
   * "Everything you were told may be incomplete — ask again."
   *
   * Fired when the event channel is (re)established, and when the daemon says
   * it dropped events for a subscriber that fell behind. The stream is what
   * keeps the session list live; this is the admission that a stream can miss
   * things, and the one call that repairs it.
   */
  onTerminalSessionsInvalidated(callback: () => void): () => void;

  /**
   * Subscribe to whether this client's live-output transport is down (returns
   * unsubscribe fn); fires immediately with the current answer.
   *
   * Only web mode can ever answer `true` — the desktop's IPC has no socket to
   * lose. A pane shows it so a phone whose PWA was backgrounded says
   * "reconnecting" instead of presenting a stale frame as the present.
   */
  onTerminalConnection(
    terminalId: string,
    callback: (reconnecting: boolean) => void,
  ): () => void;

  /**
   * Type a composed message and submit it, as two writes with a settle
   * between — `review terminal send --submit`, for the phone's compose bar.
   *
   * A newline arriving in the same write as the text is ambiguous to a TUI with
   * an open autocomplete popup (Claude Code's slash commands): it reads as
   * accepting the highlighted entry rather than submitting what was typed.
   *
   * The delay belongs to whoever cannot be suspended halfway through it. In web
   * mode that is the server, which holds the gap itself so a PWA backgrounded
   * mid-send still gets its Enter; on the desktop it is this process, which
   * nothing suspends.
   *
   * A message spanning lines is written as a **bracketed paste**, since a bare
   * newline is itself a submit — see `wrapMultilinePaste`. Each transport
   * applies it beside the write it owns, which is the same split as the settle.
   */
  terminalSubmit(terminalId: string, text: string): Promise<void>;
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
