import { anyLabelMatchesAnyPattern } from "../utils/matching";

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

// Comparison - what we're reviewing (VS Code model)
export interface Comparison {
  old: string; // Base ref (e.g., "main")
  new: string; // Compare ref (e.g., "HEAD")
  workingTree: boolean; // Include uncommitted working tree changes
  stagedOnly?: boolean; // Only show staged changes (index vs HEAD)
  key: string; // Unique key for storage, e.g., "main..HEAD+working-tree"
}

// Helper to create a Comparison object
export function makeComparison(
  old: string,
  newRef: string,
  workingTree: boolean,
  stagedOnly?: boolean,
): Comparison {
  let key = `${old}..${newRef}`;
  if (stagedOnly) {
    key += "+staged-only";
  } else if (workingTree) {
    key += "+working-tree";
  }
  return { old, new: newRef, workingTree, stagedOnly, key };
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
  status?: "approved" | "rejected"; // Explicit human decision (undefined = pending, trust computed from labels)
}

// Helper to check if a hunk's labels match any trusted pattern
export function isHunkTrusted(
  hunkState: HunkState | undefined,
  trustList: string[],
): boolean {
  if (!hunkState?.label || hunkState.label.length === 0) return false;
  return anyLabelMatchesAnyPattern(hunkState.label, trustList);
}

// Helper to check if a hunk is "reviewed" (trusted, approved, or rejected)
export function isHunkReviewed(
  hunkState: HunkState | undefined,
  trustList: string[],
): boolean {
  if (!hunkState) return false;
  if (hunkState.status) return true; // approved or rejected
  return isHunkTrusted(hunkState, trustList);
}

// Line annotations for inline comments
export interface LineAnnotation {
  id: string;
  filePath: string;
  lineNumber: number;
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
}

export interface ReviewState {
  comparison: Comparison;
  hunks: Record<string, HunkState>; // keyed by hunk id
  trustList: string[]; // List of trusted patterns
  notes: string; // Overall review notes
  annotations: LineAnnotation[]; // Inline annotations on lines
  createdAt: string;
  updatedAt: string;
}

// Summary of a saved review (for start screen listing)
export interface ReviewSummary {
  comparison: Comparison;
  totalHunks: number;
  reviewedHunks: number;
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
