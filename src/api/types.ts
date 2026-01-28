/**
 * API types - re-exports from main types for the API layer
 */

export type {
  BranchList,
  StashEntry,
  GitStatusSummary,
  StatusEntry,
  Comparison,
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

export interface ClaudeCodeStatus {
  active: boolean;
  session_count: number;
  last_activity: string | null;
}

export interface ClaudeCodeMessage {
  timestamp: string;
  message_type: string;
  summary: string;
}

export interface ClaudeCodeSession {
  session_id: string;
  last_activity: string;
  status: string;
  message_count: number;
  summary: string;
  git_branch: string;
  parent_session_id: string | null;
  chain_id: string | null;
  chain_position: number;
}

export interface ClaudeCodeChainMessage {
  timestamp: string;
  message_type: string;
  summary: string;
  session_id: string;
  session_summary: string;
}
