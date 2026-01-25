import type { Event, Uri } from "vscode";

// Re-export state types
export type {
  Comparison,
  HunkState,
  ReviewState,
  FileStatus,
  DiffHunk,
  ChangedFile,
  HunkWithStatus,
  ChangedFileWithStatus,
} from "./state/types";

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
