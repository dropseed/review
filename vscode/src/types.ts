import type { Event, Uri } from "vscode";

// Git extension types (from vscode.git API)
export interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: Event<Repository>;
}

export interface Repository {
  rootUri: Uri;
  state: RepositoryState;
  onDidChange: Event<void>;
  getBranches(query?: { remote?: boolean }): Promise<Branch[]>;
}

export interface RepositoryState {
  HEAD?: Ref;
}

export interface Ref {
  name?: string;
  commit?: string;
}

export interface Branch {
  name?: string;
  commit?: string;
  type: BranchType;
}

export enum BranchType {
  Head = 0,
  Remote = 1,
  Tag = 2,
}

// Extension-specific types
export interface DiffHunk {
  filePath: string;
  hash: string; // Hash of hunk content for staleness detection
  startLine: number; // Line number in new file
  endLine: number;
  header: string; // The @@ line
  content: string; // Full hunk content for hashing
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

// Structured comparison key
export interface ComparisonKey {
  old: string; // base branch (e.g., "master")
  new: string | null; // compare ref, null if comparing to working tree directly
  working_tree: boolean; // whether uncommitted changes are included
  key: string; // full string key for file naming/lookup (e.g., "master..feature+")
}

// State for a single hunk (stored in hunks dict)
export interface HunkState {
  suggested: "human" | "agent" | "undecided" | null; // Classification: who should review
  reviewed_by: "human" | "agent" | null; // Who actually marked it as reviewed
  reason: string | null; // Classification reason
}

// State persistence format (JSON serializable, uses snake_case for CLI compatibility)
export interface SerializedReviewState {
  comparison: ComparisonKey;
  hunks: Record<string, HunkState>; // "filepath:hash" -> state
  notes: string;
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

// CLI output types (from `human-review diff --json`)
export interface CliDiffOutput {
  comparison: string;
  trust_list: string[]; // Currently trusted patterns
  files: CliFile[];
  pagination?: {
    offset: number;
    limit: number | null;
    returned: number;
    total_matching: number;
    has_more: boolean;
  };
}

export interface CliFile {
  path: string;
  status: FileStatus;
  old_path?: string;
  hunks: CliHunk[];
}

export interface CliHunk {
  hash: string;
  labels: string[]; // Trust patterns recognized in this hunk
  reasoning: string | null; // AI explanation of what changed
  trusted: boolean; // Whether all labels are in trust list
  reviewed: boolean; // Whether manually marked as reviewed
  approved: boolean; // trusted OR reviewed
  header: string;
  content: string;
  start_line: number;
  end_line: number;
}

// CLI status output (from `human-review status --json`)
export interface CliStatusOutput {
  comparison: string;
  total_files: number;
  total_hunks: number;
  approved_hunks: number;
  progress_percent: number;
  by_file_status: Record<string, { files: number; hunks: number }>;
  unreviewed: Array<{ label: string; count: number }>;
  trusted: Array<{ label: string; count: number }>;
  reviewed: Array<{ label: string; count: number }>;
  unlabeled: number;
}

// Trust list output (from `human-review trust --list --json` - if we add it)
export interface TrustListOutput {
  patterns: string[];
}
