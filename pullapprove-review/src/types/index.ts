// Comparison - what we're reviewing (VS Code model)
export interface Comparison {
  old: string; // Base ref (e.g., "main")
  new: string; // Compare ref (e.g., "HEAD")
  workingTree: boolean; // Include uncommitted working tree changes
  key: string; // Unique key for storage, e.g., "main..HEAD+working-tree"
}

// Helper to create a Comparison object
export function makeComparison(
  old: string,
  newRef: string,
  workingTree: boolean
): Comparison {
  const key = workingTree
    ? `${old}..${newRef}+working-tree`
    : `${old}..${newRef}`;
  return { old, new: newRef, workingTree, key };
}

// File tree
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
  // Change status
  status?: "added" | "modified" | "deleted" | "renamed" | "untracked" | "gitignored";
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
  label?: string[]; // Trust pattern labels (can have multiple)
  reasoning?: string; // AI classification reasoning
  approvedVia?: "manual" | "trust" | "ai";
  rejected?: boolean; // Explicit rejection flag
  notes?: string; // Human review notes
}

// Rejection feedback for export
export interface RejectionFeedback {
  comparison: Comparison;
  exportedAt: string;
  rejections: Array<{
    hunkId: string;
    filePath: string;
    notes?: string;
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
  createdAt: string;
  updatedAt: string;
  completedAt?: string; // When review was marked complete
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
