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
  date: string;
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
  old: string; // Base ref (e.g., "main")
  new: string; // Compare ref (e.g., "HEAD")
  workingTree: boolean; // Include uncommitted working tree changes (auto-detected)
  key: string; // Unique key for storage, e.g., "main..HEAD"
  githubPr?: GitHubPrRef; // Optional GitHub PR reference
}

// Helper to create a Comparison object
export function makeComparison(
  old: string,
  newRef: string,
  workingTree: boolean,
): Comparison {
  const key = `${old}..${newRef}`;
  return { old, new: newRef, workingTree, key };
}

// Helper to create a Comparison for a GitHub PR
export function makePrComparison(pr: PullRequest): Comparison {
  return {
    old: pr.baseRefName,
    new: pr.headRefName,
    workingTree: false,
    key: `pr-${pr.number}`,
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
    | "untracked"
    | "gitignored";
  // Symlink info
  isSymlink?: boolean;
  symlinkTarget?: string;
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

// Move pair information
export interface MovePair {
  sourceHunkId: string;
  destHunkId: string;
  sourceFilePath: string;
  destFilePath: string;
}

export interface DiffLine {
  type: "context" | "added" | "removed";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Review state
export interface HunkState {
  label: string[]; // Classification labels, defaults to []
  reasoning?: string; // AI classification reasoning
  status?: "approved" | "rejected" | "saved_for_later"; // Explicit human decision (undefined = pending, trust computed from labels)
  classifiedVia?: "static" | "ai"; // Source of classification
}

// Helper to check if a hunk's labels match any trusted pattern
export function isHunkTrusted(
  hunkState: HunkState | undefined,
  trustList: string[],
): boolean {
  if (!hunkState?.label || hunkState.label.length === 0) return false;
  return anyLabelMatchesAnyPattern(hunkState.label, trustList);
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
  if (hunkState.status === "approved" || hunkState.status === "rejected")
    return true;
  return isHunkTrusted(hunkState, trustList);
}

// Helper to check if a hunk is saved for later
export function isHunkSavedForLater(hunkState: HunkState | undefined): boolean {
  return hunkState?.status === "saved_for_later";
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
  /** Hunk IDs that heuristics determined should skip AI classification */
  skippedHunkIds?: string[];
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

export interface SummaryInput {
  id: string;
  filePath: string;
  content: string;
  label?: string[];
}

export interface HunkGroup {
  title: string;
  description: string;
  hunkIds: string[];
}

export interface GuideState {
  groups: HunkGroup[];
  hunkIds: string[];
  generatedAt: string;
  summary?: string;
}

export interface ReviewState {
  comparison: Comparison;
  hunks: Record<string, HunkState>; // keyed by hunk id
  trustList: string[]; // List of trusted patterns
  notes: string; // Overall review notes
  annotations: LineAnnotation[]; // Inline annotations on lines
  autoApproveStaged?: boolean; // When true, hunks in staged files are treated as reviewed
  createdAt: string;
  updatedAt: string;
  version: number; // Version counter for optimistic concurrency control
  guide?: GuideState; // AI-generated guide state (grouping + summary)
  totalDiffHunks?: number; // Total diff hunks (including unclassified) for accurate progress
}

// Summary of a saved review tagged with repo info (for cross-repo listing)
export interface GlobalReviewSummary extends ReviewSummary {
  repoPath: string;
  repoName: string;
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
  state: "approved" | "changes_requested" | null;
  updatedAt: string;
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

export interface FileSymbolDiff {
  filePath: string;
  symbols: SymbolDiff[];
  topLevelHunkIds: string[];
  hasGrammar: boolean;
  symbolReferences: SymbolReference[];
}

// API operation types

export interface HunkInput {
  id: string;
  filePath: string;
  content: string;
}

export interface ClassifyOptions {
  command?: string;
  batchSize?: number;
  maxConcurrent?: number;
}

export interface DetectMovePairsResponse {
  pairs: MovePair[];
  hunks: DiffHunk[];
}

export interface ExpandedContext {
  lines: string[];
  startLine: number;
  endLine: number;
}

export interface SearchMatch {
  filePath: string;
  lineNumber: number;
  column: number;
  lineContent: string;
}

export interface RemoteInfo {
  name: string;
  browseUrl: string;
}

// Lightweight diff statistics from git diff --shortstat
export interface DiffShortStat {
  fileCount: number;
  additions: number;
  deletions: number;
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
