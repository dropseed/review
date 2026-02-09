// Subset of desktop types (src/types/index.ts) needed for the mobile app

export interface GitHubPrRef {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  body?: string;
}

export interface Comparison {
  old: string;
  new: string;
  workingTree: boolean;
  key: string;
  githubPr?: GitHubPrRef;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
  status?:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "untracked"
    | "gitignored";
}

export interface DiffLine {
  type: "context" | "added" | "removed";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  id: string;
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  content: string;
  lines: DiffLine[];
  contentHash: string;
  movePairId?: string;
}

export interface HunkState {
  label: string[];
  reasoning?: string;
  status?: "approved" | "rejected";
  classifiedVia?: "static" | "ai";
}

export interface LineAnnotation {
  id: string;
  filePath: string;
  lineNumber: number;
  endLineNumber?: number;
  side: "old" | "new" | "file";
  content: string;
  createdAt: string;
}

export interface ReviewState {
  comparison: Comparison;
  hunks: Record<string, HunkState>;
  trustList: string[];
  notes: string;
  annotations: LineAnnotation[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GlobalReviewSummary {
  repoPath: string;
  repoName: string;
  comparison: Comparison;
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  reviewedHunks: number;
  rejectedHunks: number;
  state: "approved" | "changes_requested" | null;
  updatedAt: string;
}

export interface ReviewSummary {
  comparison: Comparison;
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  reviewedHunks: number;
  rejectedHunks: number;
  state: "approved" | "changes_requested" | null;
  updatedAt: string;
}

export type ContentType = "text" | "image" | "svg" | "binary";

export interface FileContent {
  content: string;
  oldContent?: string;
  diffPatch: string;
  hunks: DiffHunk[];
  contentType: ContentType;
}

export interface TrustPattern {
  id: string;
  category: string;
  name: string;
  description: string;
}

export interface TrustCategory {
  id: string;
  name: string;
  patterns: TrustPattern[];
}

export interface ServerInfo {
  version: string;
  hostname: string;
  repos: string[];
}
