/**
 * API types - re-exports from main types for the API layer
 */

export type {
  BranchList,
  StashEntry,
  GitStatusSummary,
  StatusEntry,
  Comparison,
  CommitEntry,
  FileEntry,
  DiffHunk,
  DiffLine,
  MovePair,
  HunkState,
  LineAnnotation,
  RejectionFeedback,
  ClassificationResult,
  ClassifyResponse,
  ReviewState,
  ReviewSummary,
  TrustPattern,
  TrustCategory,
  ContentType,
  FileContent,
} from "../types";

// Additional types for API operations

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
  pairs: import("../types").MovePair[];
  hunks: import("../types").DiffHunk[];
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
