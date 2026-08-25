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
 * Describe a trusted label for "untrust" UI copy: just the label when the
 * matching trust-list entry is an exact match, or the label plus the
 * wildcard pattern when removing that pattern would affect other labels too.
 */
export function describeTrustedLabel(label: string, pattern: string): string {
  return pattern === label ? `"${label}"` : `"${label}" (pattern "${pattern}")`;
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
  /** Commit message body, trimmed. Absent when the commit has no body. */
  body?: string;
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

// Maps a comparison's net-diff hunks to the commit(s) that introduced their
// lines. Derived on demand from `base..head` — never persisted.
export interface HunkAttribution {
  // Commits in base..head, oldest first (the author's narrative order).
  commits: CommitEntry[];
  // Hunk id -> full commit SHAs that touched it, oldest first. Empty when a
  // hunk (typically a pure deletion) couldn't be attributed.
  hunkCommits: Record<string, string[]>;
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

/**
 * One commit, resolved into something diffable.
 *
 * The comparison carries resolved SHAs, not `<hash>^` — that expression names
 * nothing for a root commit and is ambiguous for a merge, which are exactly
 * the two cases `parentCount` exists to report.
 */
export interface CommitComparison {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** Author date, ISO-8601 strict. */
  date: string;
  /** 0 for a root commit, more than 1 for a merge. */
  parentCount: number;
  /** `parent..commit` — a merge's first parent, a root's empty tree. */
  comparison: Comparison;
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

// One open PR the user has out, from the account-wide viewer query — not
// scoped to a repository the way PullRequest is.
export interface ViewerPr {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  repoNameWithOwner: string; // the BASE repo — "dropseed/review"
  repoUrl: string;
  /**
   * The head (fork) repo the branch lives in, null when it has been deleted.
   *
   * Display uses `repoNameWithOwner` — the base repo is where the PR *is*.
   * This exists because the local join runs off the head repo alone: a
   * stranger's fork PR targeting a repo you have cloned must not badge your
   * branch of the same name, so it arrives with `repoPath: null` and lands in
   * the elsewhere bucket.
   */
  headRepoNameWithOwner: string | null;
  reviewDecision: string | null; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
  checksState: string | null; // SUCCESS | FAILURE | PENDING | ERROR | EXPECTED
  /** Local path of the registered repo this PR belongs to, when Review knows it. */
  repoPath: string | null;
}

/**
 * A pull request Review watched land.
 *
 * The viewer query asks for open PRs only, so a merge is never a change in
 * `prs` — it is a disappearance. The backend confirms each departure once and
 * keeps the answer (see `core/src/service/shipped.rs`); this is that answer,
 * carrying the repo and branch it belongs to so a workspace card can find its
 * own.
 */
export interface ShippedPr {
  number: number;
  url: string;
  title: string;
  mergedAt: string;
  /** The local repo the branch lives in, as an attachment spells it. */
  repoPath: string;
  headRefName: string;
  /** When Review confirmed the merge — not when GitHub merged it. */
  confirmedAt: string;
}

// Last known state of the user's open PRs. `error` and `prs` are independent:
// an errored snapshot still carries the last good data, dated when it was
// fetched, so a failure never masquerades as "no open PRs".
export interface ViewerPrSnapshot {
  fetchedAt: string; // ISO 8601; the Unix epoch means "never fetched"
  prs: ViewerPr[];
  truncated: boolean; // more open PRs than the query's page of 100
  error: string | null;
  /** Recently confirmed merges, newest first. */
  shipped: ShippedPr[];
  /**
   * Whether GitHub is reachable *in principle* — false only when `gh` is
   * missing or unauthenticated. That is not a failure to report, it's a user
   * who doesn't have the feature, so the UI shows nothing rather than a warning
   * that can never be cleared. `error` still carries the reason for debugging.
   */
  available: boolean;
}

// Comparison - the resolved base..head pair the data endpoints diff. This is
// *plumbing*, not identity: a review is identified by its `ref` (see
// ResolvedReview / ReviewState), and the base is derived at read time. The
// frontend obtains a Comparison from `resolveReview` and passes it to the data
// endpoints (list_files, get_all_hunks, get_diff*, symbols, freshness, ...).
export interface Comparison {
  base: string; // Base ref (e.g., "main")
  head: string; // Head ref (e.g., "feature")
  key: string; // Always "{base}..{head}"
}

// Which arm of the backend resolution ladder produced a review's base — the
// intent behind the bare `base..head`, so the UI can label it honestly.
// Mirrors core's `service::targets::BaseReason`.
export type BaseReason =
  | "override" // an explicit base override is pinned
  | "pullRequest" // a fetched PR head vs the PR's base branch
  | "trunkWorkingTree" // the default branch vs itself (its uncommitted work)
  | "branchVsDefault" // a non-default branch vs the default branch
  | "singleCommit"; // any other rev reviewed as one commit

// A resolved review: its identity (`ref` + optional `baseOverride`) alongside
// the concrete Comparison the data endpoints diff. Returned by the identity
// endpoints (`resolveReview`, `setBaseOverride`); the frontend keeps the
// identity and passes the comparison onward. Mirrors core's
// `service::targets::ResolvedReview`.
export interface ResolvedReview {
  ref: string;
  baseOverride?: string;
  comparison: Comparison;
  baseReason: BaseReason;
}

// Helper to create a Comparison object
export function makeComparison(base: string, head: string): Comparison {
  const key = `${base}..${head}`;
  return { base, head, key };
}

// A review target the picker hands off: the ref to review plus an optional base
// override and GitHub PR reference. `resolveReview(repoPath, ref, baseOverride)`
// turns it into a ResolvedReview.
export interface ReviewTarget {
  ref: string;
  baseOverride?: string;
  githubPr?: GitHubPrRef;
}

/**
 * How much of a review is present locally.
 *
 * - `listed` — metadata only; the diff has not been fetched.
 * - `fetched` — the diff reads locally; no working tree.
 * - `materialized` — a worktree exists, so terminals, LSP, and staging work.
 */
export type ReviewTier = "listed" | "fetched" | "materialized";

export interface ReviewTierInfo {
  tier: ReviewTier;
  worktreePath?: string;
}

/** One rate-limit window for a coding agent (Claude's session, Codex's weekly). */
export interface UsageWindow {
  label: string;
  usedPercent: number;
  /** Unix seconds when the window resets, when the agent gives a timestamp. */
  resetsAtUnix: number | null;
  /** The agent's own reset wording, when that's all it gives (Claude). */
  resetsAtText: string | null;
  /** How long the window runs — with the reset time, this places "now" in it. */
  windowMinutes: number | null;
  /** The long-horizon cap, as the agent's own parser identified it. */
  headline: boolean;
}

export interface AgentUsage {
  id: string;
  name: string;
  windows: UsageWindow[];
  plan: string | null;
  /** When the snapshot was taken. `null` means it was read live. */
  observedAtUnix: number | null;
}

/**
 * What a PR has to say for a review to be started from it — the part
 * `PullRequest` (repo-scoped) and `ViewerPr` (account-wide) have in common.
 *
 * `body` is optional because the account-wide query doesn't ask for
 * descriptions: dozens of them, to render a sidebar. A review started from the
 * sidebar therefore has no PR body in its overview.
 */
interface PrReviewSource {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  body?: string;
}

// A PR reviews its head branch, with the PR's base branch as the base override.
export function prReviewTarget(pr: PrReviewSource): ReviewTarget {
  return {
    ref: pr.headRefName,
    baseOverride: pr.baseRefName,
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
// or annotation. One provenance vocabulary across the whole model.
export type Source =
  | "static" // rule-based classifier
  | "ai" // the app's built-in Claude classification pass
  | "ui" // a human in the desktop app
  | "cli" // a human via the review CLI
  | "agent" // an external agent (Claude/Codex) through the CLI
  | "github"
  | "gitlab";

// A value paired with its provenance and an optional rationale. Each axis of a
// HunkState — classification, status — is an Attributed<T>.
export interface Attributed<T> {
  value: T;
  source: Source;
  reasoning?: string;
}

export type HunkStatusValue = "approved" | "rejected" | "saved_for_later";

// The review record for a single hunk. Each field is an independent axis:
// classification (what kind of change) and status (the review decision).
// All optional — absent means "not set".
export interface HunkState {
  classification?: Attributed<string[]>;
  status?: Attributed<HunkStatusValue>;
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

// A stable empty trust list.
//
// `reviewState?.trustList ?? []` allocates a fresh array on every render, so
// any memo or effect keyed on it recomputes every render for a review that has
// no trust list — which the hooks linter flags. Sharing one frozen-by-
// convention array keeps that identity stable. Nothing mutates a trust list;
// it is replaced wholesale.
export const EMPTY_TRUST_LIST: string[] = [];

// Whether a hunk is auto-approved by the trust list — i.e. its label is
// trust-listed. (An explicit approve/reject still wins — callers check
// `status` before this.) This is the single chokepoint every "is it
// effectively reviewed/trusted" consumer routes through.
export function isHunkTrusted(
  hunkState: HunkState | undefined,
  trustList: string[],
): boolean {
  const labels = hunkState?.classification?.value;
  if (!labels || labels.length === 0) return false;
  return anyLabelMatchesAnyPattern(labels, trustList);
}

// The effective review status of a hunk, collapsing the axes into one label:
// an explicit decision wins; otherwise a trust-listed label reads as
// "trusted"; otherwise "unreviewed". The single source of truth
// the CLI's EffectiveStatus mirrors and every status consumer should route
// through.
export type EffectiveStatusValue =
  "unreviewed" | "trusted" | "approved" | "rejected" | "saved";

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

export interface HunkGroup {
  title: string;
  description?: string;
  hunkIds: string[];
  /** True when this group was created by client-side patching, not the authored guide. */
  ungrouped?: boolean;
  /** Optional short label displayed next to the title (e.g. "Trust pattern"). */
  badgeLabel?: string;
}

export interface GuideGenerated {
  groups: HunkGroup[];
  hunkIds: string[];
  generatedAt: string;
}

export interface Guide {
  state?: GuideGenerated;
}

/**
 * Progress counted against a diff rather than against the decision map —
 * mirrors core's `MeasuredProgress`. See `ReviewState::measure`.
 */
export interface MeasuredProgress {
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  rejectedHunks: number;
  reviewedHunks: number;
  savedForLaterHunks: number;
}

export interface ReviewState {
  schemaVersion?: number; // On-disk format version (migrated forward on read)
  // The review's identity: the ref being reviewed (branch/SHA/tag/stash).
  ref: string;
  // Optional explicit base override; absent means "derive the base".
  baseOverride?: string;
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
  /**
   * Progress as the backend last counted it against a complete diff, on save.
   *
   * Read-only from here — counting it needs the diff *and* the decisions, and
   * doing that in two languages is what produced two answers that disagreed.
   * `computeReviewProgress` is still what the open review renders from; this is
   * what every *other* review's card reads, since the sidebar summarizes them
   * all without loading a diff for any.
   */
  progress?: MeasuredProgress;
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
  /** How much of this review is present locally, derived by the backend. */
  tier: ReviewTier;
}

// Summary of a saved review (for start screen listing). Listing stays git-free:
// the summary carries the review's `ref` (+ optional base override) as identity,
// never a resolved comparison — resolution happens on activation.
export interface ReviewSummary {
  ref: string;
  baseOverride?: string;
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  reviewedHunks: number;
  rejectedHunks: number;
  savedForLaterHunks: number;
  state: "approved" | "changes_requested" | null;
  updatedAt: string;
  githubPr?: GitHubPrRef; // Optional GitHub PR reference
  worktreePath?: string; // Path to review-managed worktree, if created
}

// A repo a workspace is showing — one tab on the code side.
//
// Nothing about it is exclusive: any number of workspaces may attach the same
// path, so there is no holder to name and no conflict to report.
export interface Attachment {
  /** Repo root (or a plain directory), normalized backend-side. The identity. */
  path: string;
  /** A view hint — the branch being looked at. Never part of the identity. */
  refName: string | null;
}

// One workspace: a unit of intent in the work queue. Stored in
// ~/.review/work.json; array order is priority order, so the list is never
// re-sorted on read.
//
// A container that becomes what you put in it: the attachments are the code
// side's tabs, and everything live (terminals, PRs, review progress) is derived
// and joined onto it, which is why nothing here moves when the world does.
export interface Workspace {
  id: string;
  /** What the human typed. Null means the title derives — see `displayTitle`. */
  title: string | null;
  /** Always set, and what every surface renders. */
  displayTitle: string;
  /** The code side's repo tabs, in order. */
  attachments: Attachment[];
  /**
   * The workspace this one sits under, or null at the top level — how a
   * workspace that is really a subtask of a larger one says so.
   *
   * The array stays flat and stays the rendered order: the backend keeps each
   * workspace immediately followed by its own subtree, so everything that
   * counts rows (⌘1–9, the rail, the palette, the queue's drop gaps) goes on
   * counting rows, and the tree shows up as `depth`.
   */
  parentId: string | null;
  /** How many workspaces this one sits under. 0 at the top level. */
  depth: number;
  /** Everything above it, outermost first — the breadcrumb, already named. */
  ancestors: WorkspaceAncestor[];
  /** Backend plumbing for cleanup. Never rendered, never branched on. */
  autoCreated: boolean;
  createdAt: string;
}

/** One rung above a workspace, for a surface that shows it out of queue order. */
export interface WorkspaceAncestor {
  id: string;
  displayTitle: string;
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

/** A worktree plus the facts a git client would show beside it. */
export interface WorktreeStatus extends WorktreeInfo {
  /**
   * Uncommitted work — modified, staged, or untracked. Always false for the
   * main checkout, whose dirt is a fact on its branch row already; only linked
   * worktrees are asked, because a `git status` per registered repo is the
   * expensive half of listing them.
   */
  hasChanges: boolean;
}

/** One repo's worktrees, as the batched status call returns them. */
export interface RepoWorktrees {
  repoPath: string;
  worktrees: WorktreeStatus[];
}

/** Where a branch's checkout lives, and whether this call is what made it. */
export interface WorktreeCheckout {
  path: string;
  branch: string;
  /** False when the branch already had a checkout and we routed to it. */
  created: boolean;
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
  /**
   * 1-based line where the symbol's *body* starts — the first line a fold may
   * hide, so the signature (however many lines it spans, including its
   * trailing `{`) stays visible. Optional: extractors that don't report one
   * simply produce a symbol that shape mode won't fold.
   */
  bodyStartLine?: number;
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

/**
 * One requested path's place in the comparison, as of now.
 *
 * `status` absent means the comparison no longer touches this file — the edit
 * that triggered the delta put it back the way the base has it.
 */
export interface FileDeltaEntry {
  path: string;
  status?: FileEntry["status"];
  renamedFrom?: string;
  /**
   * Whether the file is on disk in the comparison's working tree. A path that
   * is neither changed nor present is one to forget rather than merely mark
   * unchanged.
   */
  exists: boolean;
}

/** The recomputed slice of a comparison covering a named set of paths. */
export interface FilesDelta {
  files: FileDeltaEntry[];
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
  // Review identity — the freshness result is keyed by `${repoPath}:${ref}`.
  // The backend resolves it (honoring baseOverride) into the comparison it diffs.
  ref: string;
  baseOverride?: string;
  githubPr?: GitHubPrRef;
  cachedOldSha: string | null;
  cachedNewSha: string | null;
}

export interface ReviewFreshnessResult {
  key: string;
  isActive: boolean;
  oldSha: string | null;
  newSha: string | null;
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
  /**
   * Commits on this branch that exist nowhere but here — `@{upstream}..branch`,
   * or every commit it has over the default branch when it has no upstream to
   * have published to. One of the sidebar's row facts: see `sidebar-tree.ts`.
   */
  unpushedCommits: number;
  /**
   * Commits its upstream has that it doesn't — zero when it has no upstream.
   *
   * Read on the *base* branch rather than the one under review: a comparison is
   * based on the local default branch, so a stale one silently folds everything
   * that landed on trunk since into the branch's own diff.
   */
  behindUpstream: number;
  hasWorkingTreeChanges: boolean;
  lastCommitDate: string;
  lastCommitMessage: string;
  /** True when the tip commit's committer email matches the repo's `user.email`. */
  lastCommitByUser: boolean;
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
}

// --- LSP types ---

export type LspServerState = "starting" | "ready" | "error" | "stopped";

export interface LspServerStatus {
  name: string;
  language: string;
  state: LspServerState;
}

// --- Terminal types ---

/**
 * Per-session terminal phase, driven by the Rust status engine (OSC 133 marks
 * when shell integration is active, foreground-process polling otherwise).
 */
export type TerminalPhase =
  "working" | "waiting_for_input" | "needs_attention" | "idle";

/**
 * Status snapshot for a single terminal session. Mirrors the backend
 * `SessionStatus` (serde camelCase). Screen content is pulled on demand via
 * `terminalPeek`, never carried on the status.
 */
export interface TerminalStatus {
  id: string;
  phase: TerminalPhase;
  runningCommand: string | null;
  lastExitCode: number | null;
  cwd: string | null;
  title: string | null;
  /** Epoch millis when the session entered its current phase. */
  enteredStateAt: number;
  shellIntegrationActive: boolean;
  /**
   * Text of the desktop-notification escape that raised the attention overlay
   * (OSC 9 from Codex, OSC 777 from Claude Code). Null when the overlay is
   * clear, or when a plain bell raised it and there was nothing to say.
   */
  attentionMessage: string | null;
}

/** Metadata describing a live terminal session (returned by start/list). */
export interface TerminalSessionInfo {
  id: string;
  repoPath: string;
  /**
   * The workspace this session belongs to — the daemon's answer, and the only
   * one: every surface that groups terminals reads this rather than keeping its
   * own record. Null only for a session started by something that skipped the
   * router, which the app re-routes when it next lists sessions.
   */
  workspaceId: string | null;
  cwd: string;
  /** Terminal title (OSC 0/2); null until the session sets one. */
  title: string | null;
  cols: number;
  rows: number;
  status: TerminalStatus;
}

/**
 * What starting a terminal answers with: the session, and the workspace the
 * backend routed it into.
 *
 * The landing is not decoration — terminals are drawn under their workspace, so
 * a session whose workspace the queue has not listed yet has nowhere to appear;
 * `created` is what tells the caller to re-read the queue.
 */
/**
 * Where routing a repo+branch landed — the answer ⌘K's Enter acts on.
 *
 * `created` is what tells the queue to re-read: a workspace the router just
 * invented is one the frontend's list has never held.
 */
export interface RouteLanding {
  workspace: Workspace;
  created: boolean;
}

export interface TerminalStarted {
  session: TerminalSessionInfo;
  workspace: {
    id: string;
    /**
     * Whether getting here invented the workspace — the reason the queue
     * re-reads. Nothing draws the title from here; the queue's own entry does.
     */
    created: boolean;
  };
}

/**
 * Payload of the `terminal:output:{id}` event — raw PTY bytes tagged with the
 * scrollback byte cursor (`seq`) they end at. A cold-reattaching pane buffers
 * live output by `seq` and drops any chunk with `seq <= replay.cursor`.
 */
export interface TerminalOutput {
  id: string;
  data: Uint8Array;
  seq: number;
}

/** Payload of the `terminal:exit:{id}` event. */
export interface TerminalExit {
  id: string;
  exitCode: number | null;
}

/**
 * Payload of the `terminal:resized:{id}` event — the PTY's new grid, after any
 * client resized it. Every attached client shares the one grid, so a pane
 * hearing this re-renders at the new size (its own resize included: the daemon
 * does not say who asked).
 */
export interface TerminalResized {
  id: string;
  cols: number;
  rows: number;
}

/** Result of `terminalReplay` — ring-buffer scrollback for xterm reattach. */
export interface TerminalReplay {
  dataB64: string;
  /**
   * Byte cursor the scrollback ends at. After writing the scrollback, a pane
   * drops any buffered live chunk whose `seq` is `<=` this value so bytes
   * captured in both the snapshot and the live stream render exactly once.
   */
  cursor: number;
  status: TerminalStatus;
}
