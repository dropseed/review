/**
 * State types for human-review VS Code extension.
 * Ported from Python human_review/state.py
 */

/**
 * Structured comparison key identifying what refs are being compared.
 */
export interface Comparison {
  /** Base ref to compare against (e.g., "master") */
  old: string;
  /** Compare ref (e.g., "HEAD", "feature") */
  new: string;
  /** If true, diff against working tree instead of new ref */
  working_tree: boolean;
  /** Full string key for file naming/lookup (e.g., "master..HEAD+working-tree") */
  key: string;
}

/**
 * State for a single hunk.
 */
export interface HunkState {
  /** Trust patterns recognized in this hunk (e.g., ["imports:added", "formatting:whitespace"]) */
  label: string[];
  /** Free-form AI explanation of what the change does */
  reasoning: string | null;
  /** How it was approved - "review" for manual review, null otherwise */
  approved_via: "review" | null;
  /** How many hunks matched when labeled (metadata) */
  count: number | null;
}

/**
 * Persisted review state for a comparison.
 */
export interface ReviewState {
  comparison: Comparison;
  /** "filepath:hash" -> state */
  hunks: Record<string, HunkState>;
  /** Review-level trusted patterns */
  trust_label: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

/**
 * Type for file status in diffs.
 */
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

/**
 * A single hunk from a diff.
 */
export interface DiffHunk {
  filePath: string;
  /** MD5 first 8 chars of content */
  hash: string;
  /** The @@ line */
  header: string;
  /** Full hunk content */
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * A file with its hunks.
 */
export interface ChangedFile {
  path: string;
  status: FileStatus;
  /** For renames, the original path */
  old_path: string | null;
  hunks: DiffHunk[];
}

/**
 * Hunk with full status information for display.
 */
export interface HunkWithStatus extends DiffHunk {
  labels: string[];
  reasoning: string | null;
  trusted: boolean;
  reviewed: boolean;
  approved: boolean;
}

/**
 * File with hunks that include status information.
 */
export interface ChangedFileWithStatus {
  path: string;
  relativePath: string;
  absolutePath: string;
  status: FileStatus;
  old_path?: string;
  hunks: HunkWithStatus[];
}
