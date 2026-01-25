/**
 * Diff parsing and hunk extraction.
 * Ported from Python human_review/hunks.py
 */

import type { ChangedFile, DiffHunk, FileStatus } from "../state/types";
import { hashContent } from "../utils/hash";

/**
 * Map git status code to our FileStatus type.
 */
function mapStatusCode(code: string): FileStatus {
  const first = code[0] || "M";
  if (first === "A") return "added";
  if (first === "D") return "deleted";
  if (first === "R") return "renamed";
  return "modified";
}

/**
 * Parse git diff --name-status output.
 * Returns a map of file path to (status, old_path).
 */
export function parseNameStatus(output: string): Map<string, { status: FileStatus; oldPath: string | null }> {
  const result = new Map<string, { status: FileStatus; oldPath: string | null }>();

  for (const line of output.trim().split("\n")) {
    if (!line) continue;

    const parts = line.split("\t");
    const statusCode = parts[0];

    // For renames (R) and copies (C), format is "R100\told\tnew"
    const isRenameOrCopy = statusCode[0] === "R" || statusCode[0] === "C";
    if (isRenameOrCopy && parts.length >= 3) {
      const oldPath = parts[1];
      const newPath = parts[2];
      result.set(newPath, { status: mapStatusCode(statusCode), oldPath });
    } else if (parts.length >= 2) {
      const filePath = parts[1];
      result.set(filePath, { status: mapStatusCode(statusCode), oldPath: null });
    }
  }

  return result;
}

/**
 * Parse hunks from a single file's diff content.
 */
function parseHunksFromContent(filePath: string, diffContent: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  // Match hunk headers: @@ -start,count +start,count @@
  const hunkPattern = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@.*$/gm;

  interface HunkStart {
    index: number;
    header: string;
    startLine: number;
    lineCount: number;
  }

  const hunkStarts: HunkStart[] = [];
  let match: RegExpExecArray | null;

  while ((match = hunkPattern.exec(diffContent)) !== null) {
    hunkStarts.push({
      index: match.index,
      header: match[0],
      startLine: Number.parseInt(match[2], 10),
      lineCount: match[3] ? Number.parseInt(match[3], 10) : 1,
    });
  }

  // Extract content for each hunk
  for (let i = 0; i < hunkStarts.length; i++) {
    const start = hunkStarts[i];
    const endIndex = i + 1 < hunkStarts.length ? hunkStarts[i + 1].index : diffContent.length;
    const content = diffContent.slice(start.index, endIndex).trim();

    // Hash only the diff lines (excluding header) so line number changes don't invalidate reviews.
    // Identical content gets the same hash - this is intentional for duplicate hunks.
    const headerEnd = start.index + start.header.length;
    const diffLines = diffContent.slice(headerEnd, endIndex).trim();
    const hunkHash = hashContent(diffLines);

    hunks.push({
      filePath,
      hash: hunkHash,
      header: start.header,
      content,
      startLine: start.startLine,
      endLine: start.startLine + start.lineCount - 1,
    });
  }

  // If no hunks found but there's content, treat as single hunk (e.g., binary file)
  if (hunks.length === 0 && diffContent.trim()) {
    hunks.push({
      filePath,
      hash: hashContent(diffContent),
      header: "(entire file)",
      content: diffContent.trim(),
      startLine: 1,
      endLine: 1,
    });
  }

  return hunks;
}

/**
 * Parse unified diff output into ChangedFile objects with hunks.
 */
export function parseDiffToHunks(
  diffOutput: string,
  fileStatusMap?: Map<string, { status: FileStatus; oldPath: string | null }>,
): ChangedFile[] {
  const files: ChangedFile[] = [];

  if (!diffOutput.trim()) {
    return files;
  }

  // Split by file headers
  // Note: git can use different prefixes (a/b, c/w, i/w) depending on config
  // mnemonicPrefix uses: c=commit, i=index, w=worktree, o=object
  const filePattern = /^diff --git \w\/(.+?) \w\/(.+)$/gm;
  const parts = diffOutput.split(filePattern);

  // parts[0] is empty or header, then groups of 3: a-path, b-path, content
  for (let i = 1; i < parts.length; i += 3) {
    if (i + 2 > parts.length) break;

    const bPath = parts[i + 1]; // Use b/ path (destination)
    const content = i + 2 < parts.length ? parts[i + 2] : "";

    const hunks = parseHunksFromContent(bPath, content);

    // Get status from map or default to modified
    let status: FileStatus = "modified";
    let oldPath: string | null = null;
    if (fileStatusMap && fileStatusMap.has(bPath)) {
      const statusInfo = fileStatusMap.get(bPath);
      if (statusInfo) {
        status = statusInfo.status;
        oldPath = statusInfo.oldPath;
      }
    }

    if (hunks.length > 0) {
      files.push({
        path: bPath,
        status,
        old_path: oldPath,
        hunks,
      });
    }
  }

  return files;
}

/**
 * Create a hunk for an untracked file.
 */
export function createUntrackedHunk(filePath: string, content: string): DiffHunk {
  return {
    filePath,
    hash: hashContent(content || `untracked:${filePath}`),
    header: "@@ -0,0 +1 @@ (new file)",
    content: "(untracked file)",
    startLine: 1,
    endLine: 1,
  };
}
