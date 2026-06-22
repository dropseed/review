// ========================================================================
// Pattern Matching Utilities
// ========================================================================
//
// IMPORTANT: These functions MUST stay in sync with the Rust implementation
// in compare/src/trust/matching.rs. Both implementations have parity tests.
//
// The Rust version uses manual string splitting, while this uses regex.
// Both produce identical results for all supported patterns.
//
// Patterns support:
// - Exact matches: "imports:added" matches only "imports:added"
// - Wildcard suffix: "imports:*" matches "imports:added", "imports:removed"
// - Wildcard prefix: "*:added" matches "imports:added", "comments:added"
// - Multiple wildcards: "*:*" matches any "category:label" pattern
//
// ========================================================================

/**
 * Check if a label matches a pattern.
 * Supports wildcards (`*`) that match any sequence of characters.
 */
export function matchesPattern(label: string, pattern: string): boolean {
  // If no wildcards, use exact match
  if (!pattern.includes("*")) {
    return label === pattern;
  }

  // Convert glob pattern to regex
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // Convert * to regex .*
  const regexPattern = escaped.replace(/\*/g, ".*");
  const regex = new RegExp(`^${regexPattern}$`);

  return regex.test(label);
}

/**
 * Check if a label matches any pattern in a list.
 */
export function matchesAnyPattern(label: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(label, pattern));
}

/**
 * Find the first pattern in a list that matches the label.
 */
export function findMatchingPattern(
  label: string,
  patterns: string[],
): string | undefined {
  return patterns.find((pattern) => matchesPattern(label, pattern));
}

/**
 * Check if any label in an array matches any pattern in a list.
 */
export function anyLabelMatchesAnyPattern(
  labels: string[],
  patterns: string[],
): boolean {
  return labels.some((label) => matchesAnyPattern(label, patterns));
}

/**
 * Check if any label in an array matches a specific pattern.
 */
export function anyLabelMatchesPattern(
  labels: string[],
  pattern: string,
): boolean {
  return labels.some((label) => matchesPattern(label, pattern));
}

// ========================================================================
// Domain Types
// ========================================================================

// A commit entry from git log
export interface CommitEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  fileCount?: number;
  additions?: number;
  deletions?: number;
}

// Detailed commit information including changed files
export interface CommitDetail {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  files: CommitFileChange[];
  diff: string;
}

// A file changed in a commit
export interface CommitFileChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

// A stash entry
export interface StashEntry {
  ref: string; // The stash ref (e.g., "stash@{0}")
  message: string; // The stash message/description
}

// Branch list with local and remote branches separated
export interface BranchList {
  local: string[];
  remote: string[];
  stashes: StashEntry[];
  /** Map from branch name to ISO-8601 committer date. */
  dates?: Record<string, string>;
}

// Git status types
export interface GitStatusSummary {
  currentBranch: string;
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  untracked: string[];
}

export interface StatusEntry {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
}

// GitHub PR types
export interface GitHubPrRef {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  body?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  author: { login: string };
  state: string;
  isDraft: boolean;
  updatedAt: string;
  body: string;
}

// Comparison - what we're reviewing
export interface Comparison {
  base: string; // Base ref (e.g., "main")
  head: string; // Head ref (e.g., "feature")
  key: string; // Always "{base}..{head}"
}

// A kind of thing to review that the backend resolves into a Comparison.
// Mirrors core's `service::targets::ReviewTarget` (serde tag = "kind").
export type ReviewTarget =
  | { kind: "working" } // uncommitted changes only
  | { kind: "staged" } // the git index
  | { kind: "stash"; index: number }
  | { kind: "commit"; rev: string }
  | { kind: "snapshot"; rev: string };

/**
 * Return the git range string for a comparison, or undefined when
 * base and head are identical (no divergent range to query).
 */
export function getComparisonRange(c: Comparison): string | undefined {
  return c.base !== c.head ? c.key : undefined;
}

// Helper to create a Comparison object
export function makeComparison(base: string, head: string): Comparison {
  const key = `${base}..${head}`;
  return { base, head, key };
}

// Helper to create a Comparison and GitHubPrRef from a PullRequest
export function makeComparisonFromPr(pr: PullRequest): {
  comparison: Comparison;
  githubPr: GitHubPrRef;
} {
  return {
    comparison: makeComparison(pr.baseRefName, pr.headRefName),
    githubPr: {
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      body: pr.body || undefined,
    },
  };
}

// File tree
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
  // Change status
  status?:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "gitignored";
  // Symlink info
  isSymlink?: boolean;
  symlinkTarget?: string;
  // Rename info (old path before rename)
  renamedFrom?: string;
  // File size in bytes (only for files, from local git)
  size?: number;
  // Last modified time as unix timestamp in seconds (only for files, from local git)
  modifiedAt?: number;
}

// Diff hunks
export interface DiffHunk {
  id: string; // filepath:hash
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  content: string;
  // Lines with +/- prefixes
  lines: DiffLine[];
  // Content hash (without filepath) for move detection
  contentHash: string;
  // ID of the paired hunk if this is part of a move
  movePairId?: string;
}

/**
 * Whether a hunk ID names the given file. Hunk IDs are `filepath:hash`
 * (see DiffHunk.id) — this is the one place that structure is parsed.
 */
export function hunkIdBelongsToFile(hunkId: string, filePath: string): boolean {
  return hunkId.startsWith(`${filePath}:`);
}

// Move pair information
export interface MovePair {
  sourceHunkId: string;
  destHunkId: string;
  sourceFilePath: string;
  destFilePath: string;
}

/**
 * Per-file diff bundle. The store is keyed by `filePath` → `FileDiff`, so
 * edits to one file touch only that entry. `contentHash` is the concatenation
 * of hunk IDs (which embed content hashes); we use it for O(1) equality
 * checks to decide whether to write a new reference or reuse the old one.
 */
export interface FileDiff {
  hunks: DiffHunk[];
  contentHash: string;
}

/** Build a FileDiff from a hunks array. contentHash is the joined IDs. */
export function buildFileDiff(hunks: DiffHunk[]): FileDiff {
  let contentHash = "";
  for (let i = 0; i < hunks.length; i++) {
    if (i > 0) contentHash += "|";
    contentHash += hunks[i].id;
  }
  return { hunks, contentHash };
}

export interface DiffLine {
  type: "context" | "added" | "removed";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Review state

// Where a value came from — the producer that set a classification, status,
// risk level, or annotation. One provenance vocabulary across the whole model.
export type Source =
  | "static" // rule-based classifier
  | "ai" // the app's built-in Claude classification pass
  | "ui" // a human in the desktop app
  | "cli" // a human via the review CLI
  | "agent" // an external agent (Claude/Codex) through the CLI
  | "github"
  | "gitlab";

// A value paired with its provenance and an optional rationale. Each axis of a
// HunkState — classification, status, risk — is an Attributed<T>.
export interface Attributed<T> {
  value: T;
  source: Source;
  reasoning?: string;
}

export type HunkStatusValue = "approved" | "rejected" | "saved_for_later";
export type HunkRisk = "low" | "high";

// The review record for a single hunk. Each field is an independent axis:
// classification (what kind of change), status (the review decision), and risk
// (blast radius). All optional — absent means "not set".
export interface HunkState {
  classification?: Attributed<string[]>;
  status?: Attributed<HunkStatusValue>;
  risk?: Attributed<HunkRisk>;
}

// Construct an attributed value, omitting reasoning when not provided.
export function attributed<T>(
  value: T,
  source: Source,
  reasoning?: string,
): Attributed<T> {
  return reasoning != null ? { value, source, reasoning } : { value, source };
}

// The classification labels for a hunk, or [] when unclassified.
export function hunkLabels(hunkState: HunkState | undefined): string[] {
  return hunkState?.classification?.value ?? [];
}

// Helper to check if a hunk has not been processed by any classifier yet.
export function isHunkUnclassified(hunkState: HunkState | undefined): boolean {
  return !hunkState?.classification;
}

// Whether a hunk is auto-approved by the trust list — i.e. its label is
// trust-listed AND it is not flagged high-risk. High risk vetoes auto-trust:
// a risky change is never silently approved by a trust-listed label; it must
// be reviewed explicitly. (An explicit approve/reject still wins — callers
// check `status` before this.) This is the single chokepoint every "is it
// effectively reviewed/trusted" consumer routes through.
export function isHunkTrusted(
  hunkState: HunkState | undefined,
  trustList: string[],
): boolean {
  if (hunkState?.risk?.value === "high") return false;
  const labels = hunkState?.classification?.value;
  if (!labels || labels.length === 0) return false;
  return anyLabelMatchesAnyPattern(labels, trustList);
}

// The effective review status of a hunk, collapsing the axes into one label:
// an explicit decision wins; otherwise a trust-listed label (not vetoed by high
// risk) reads as "trusted"; otherwise "unreviewed". The single source of truth
// the CLI's EffectiveStatus mirrors and every status consumer should route
// through.
export type EffectiveStatusValue =
  | "unreviewed"
  | "trusted"
  | "approved"
  | "rejected"
  | "saved";

export function effectiveHunkStatus(
  hunkState: HunkState | undefined,
  trustList: string[],
): EffectiveStatusValue {
  const status = hunkState?.status?.value;
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "saved_for_later") return "saved";
  if (isHunkTrusted(hunkState, trustList)) return "trusted";
  return "unreviewed";
}

// Helper to check if a hunk is "reviewed" (trusted, approved, rejected, or staged-approved)
export function isHunkReviewed(
  hunkState: HunkState | undefined,
  trustList: string[],
  options?: {
    autoApproveStaged?: boolean;
    stagedFilePaths?: Set<string>;
    filePath?: string;
  },
): boolean {
  // Check staged-approved first (doesn't require hunkState)
  if (
    options?.autoApproveStaged &&
    options.filePath &&
    options.stagedFilePaths?.has(options.filePath)
  ) {
    return true;
  }
  if (!hunkState) return false;
  const es = effectiveHunkStatus(hunkState, trustList);
  return es === "approved" || es === "rejected" || es === "trusted";
}

// Line annotations for inline comments
export interface LineAnnotation {
  id: string;
  filePath: string;
  lineNumber: number;
  endLineNumber?: number; // if set, annotation covers lineNumber..endLineNumber
  side: "old" | "new" | "file"; // which version of the file (old=deletion side, new=addition side, file=full file view)
  content: string;
  createdAt: string;
  // Display name of the author (git user, "claude", "codex", GH login).
  // Absent on legacy annotations.
  author?: string;
  // Where this comment came from. Absent on legacy annotations.
  source?: Source;
  // Last edit time; absent until first edit.
  updatedAt?: string;
  // Presence means "resolved".
  resolvedAt?: string;
  resolvedBy?: string;
}

// Rejection feedback for export
export interface RejectionFeedback {
  comparison: Comparison;
  exportedAt: string;
  rejections: Array<{
    hunkId: string;
    filePath: string;
    content: string;
  }>;
}

// Classification types for Claude integration
export interface ClassificationResult {
  label: string[];
  reasoning: string;
}

export interface ClassifyResponse {
  classifications: Record<string, ClassificationResult>;
}

export interface HunkSymbolDef {
  name: string;
  kind?: string;
  changeType: string;
}

export interface HunkSymbolRef {
  name: string;
}

export interface ModifiedSymbolEntry {
  name: string;
  kind?: string;
  changeType: string;
  filePath: string;
}

export interface GroupingInput {
  id: string;
  filePath: string;
  content: string;
  label?: string[];
  symbols?: HunkSymbolDef[];
  references?: HunkSymbolRef[];
  hasGrammar?: boolean;
}

export interface HunkGroup {
  title: string;
  description?: string;
  hunkIds: string[];
  phase?: string;
  /** True when this group was created by client-side patching, not AI grouping. */
  ungrouped?: boolean;
  /** Optional short label displayed next to the title (e.g. "Trust pattern"). */
  badgeLabel?: string;
}

/** A single event emitted during streaming grouping. */
export type GroupingEvent =
  | { type: "partialTitle"; title: string }
  | ({ type: "group" } & HunkGroup);

export interface GuideGenerated {
  groups: HunkGroup[];
  hunkIds: string[];
  generatedAt: string;
}

export interface Guide {
  autoStart?: boolean;
  state?: GuideGenerated;
}

export interface ReviewState {
  schemaVersion?: number; // On-disk format version (migrated forward on read)
  comparison: Comparison;
  hunks: Record<string, HunkState>; // keyed by hunk id
  trustList: string[]; // List of trusted patterns
  notes: string; // Overall review notes
  annotations: LineAnnotation[]; // Inline annotations on lines
  autoApproveStaged?: boolean; // When true, hunks in staged files are treated as reviewed
  createdAt: string;
  updatedAt: string;
  version: number; // Version counter for optimistic concurrency control
  guide?: Guide; // Guide config + AI-generated state (grouping)
  totalDiffHunks: number; // Total diff hunks (including unclassified) for accurate progress
  githubPr?: GitHubPrRef; // Optional GitHub PR reference
  worktreePath?: string; // Path to review-managed worktree, if created
}

// Result of loading a review: the state plus how many decisions reconciliation
// carried forward onto the current diff (for surfacing "N carried forward").
export interface ReviewLoadResult {
  state: ReviewState;
  carriedForward: number;
}

// Summary of a saved review tagged with repo info (for cross-repo listing)
export interface GlobalReviewSummary extends ReviewSummary {
  repoPath: string;
  repoName: string;
  diffStats?: DiffShortStat;
}

// Summary of a saved review (for start screen listing)
export interface ReviewSummary {
  comparison: Comparison;
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  reviewedHunks: number;
  rejectedHunks: number;
  savedForLaterHunks: number;
  highRiskPendingHunks?: number; // High-risk hunks still awaiting a decision
  state: "approved" | "changes_requested" | null;
  unreadable?: boolean; // File exists but couldn't be parsed; opening fails loudly
  updatedAt: string;
  githubPr?: GitHubPrRef; // Optional GitHub PR reference
  worktreePath?: string; // Path to review-managed worktree, if created
}

// Information about a git worktree
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
  commitHash: string;
  isDetached: boolean;
  isReviewManaged: boolean;
}

// Trust patterns
export interface TrustPattern {
  id: string; // e.g., "imports:added"
  category: string; // e.g., "imports"
  name: string; // e.g., "added"
  description: string;
}

export interface TrustCategory {
  id: string;
  name: string;
  patterns: TrustPattern[];
}

// Symbol extraction types
export type SymbolKind =
  | "function"
  | "class"
  | "struct"
  | "trait"
  | "impl"
  | "method"
  | "enum"
  | "interface"
  | "module"
  | "type";

export type SymbolChangeType = "added" | "removed" | "modified";

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface FileSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  children: FileSymbol[];
  depth?: number;
}

export interface RepoFileSymbols {
  filePath: string;
  symbols: FileSymbol[];
}

export interface SymbolDiff {
  name: string;
  kind: SymbolKind | null;
  changeType: SymbolChangeType;
  hunkIds: string[];
  children: SymbolDiff[];
  oldRange?: LineRange;
  newRange?: LineRange;
}

export interface SymbolReference {
  symbolName: string;
  hunkId: string;
  /** 1-based line numbers where the reference appears within the hunk. */
  lineNumbers: number[];
}

export interface SymbolDefinition {
  filePath: string;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  /** Whether this definition is in an external file (outside the repo). */
  isExternal?: boolean;
}

export interface FileSymbolDiff {
  filePath: string;
  symbols: SymbolDiff[];
  topLevelHunkIds: string[];
  hasGrammar: boolean;
  symbolReferences: SymbolReference[];
}

// Dependency graph types

export interface SymbolEdge {
  definesFile: string;
  referencesFile: string;
  symbols: string[];
}

export interface FileCluster {
  files: string[];
  edges: SymbolEdge[];
}

// API operation types

export interface DetectMovePairsResponse {
  pairs: MovePair[];
  hunks: DiffHunk[];
}

export interface ExpandedContext {
  lines: string[];
  startLine: number;
  endLine: number;
}

/**
 * Tree-sitter verification result for a search hit.
 * - "yes": parsed, query appears as an identifier at this (line, column)
 * - "no": parsed, query is NOT at this position (comment/string/substring)
 * - "unknown": verification didn't run (no grammar, non-identifier query, parse failure)
 */
export type VerifiedStatus = "yes" | "no" | "unknown";

export interface SearchMatch {
  filePath: string;
  lineNumber: number;
  column: number;
  lineContent: string;
  verified: VerifiedStatus;
}

export interface RemoteInfo {
  name: string;
  browseUrl: string;
}

// Review freshness checking
export interface ReviewFreshnessInput {
  repoPath: string;
  comparison: Comparison;
  githubPr?: GitHubPrRef;
  cachedOldSha: string | null;
  cachedNewSha: string | null;
}

export interface ReviewFreshnessResult {
  key: string;
  isActive: boolean;
  oldSha: string | null;
  newSha: string | null;
  diffStats: DiffShortStat | null;
  /** Refs from the comparison that no longer exist (e.g. deleted branch). */
  missingRefs?: string[];
}

// Lightweight diff statistics from git diff --shortstat
export interface DiffShortStat {
  fileCount: number;
  additions: number;
  deletions: number;
}

// Commit streaming types
export interface CommitOutputLine {
  text: string;
  stream: "stdout" | "stderr";
  seq: number;
}

export interface CommitResult {
  success: boolean;
  commitHash: string | null;
  summary: string;
}

// File content from backend
export type ContentType = "text" | "image" | "svg" | "binary";

export interface FileContent {
  content: string;
  oldContent?: string; // Old/base version for diff expansion
  diffPatch: string;
  hunks: DiffHunk[];
  contentType: ContentType;
  imageDataUrl?: string;
  oldImageDataUrl?: string;
}

// Local activity types
export interface LocalBranchInfo {
  name: string;
  isCurrent: boolean;
  commitsAhead: number;
  hasWorkingTreeChanges: boolean;
  lastCommitDate: string;
  lastCommitMessage: string;
  worktreePath: string | null;
  /** Most recent modification time of any changed file (Unix millis), only for working tree changes. */
  lastModifiedAt: number | null;
  /** Diff stats for working tree changes (files changed, additions, deletions). */
  workingTreeStats: DiffShortStat | null;
}

export interface RecentRemoteBranch {
  /** Full remote ref short name, e.g. "origin/claude/feature-x". */
  remoteRef: string;
  /** Branch name with the remote prefix stripped, e.g. "claude/feature-x". */
  branchName: string;
  /** Last commit date (ISO-8601 strict). */
  lastCommitDate: string;
}

export interface RepoLocalActivity {
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  branches: LocalBranchInfo[];
  recentRemoteBranches: RecentRemoteBranch[];
  /** Unix seconds of the last `git fetch` (FETCH_HEAD mtime). */
  lastFetchedAt?: number | null;
}

// --- LSP types ---

export type LspServerState = "starting" | "ready" | "error" | "stopped";

export interface LspServerStatus {
  name: string;
  language: string;
  state: LspServerState;
}
