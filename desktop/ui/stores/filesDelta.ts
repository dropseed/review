import type {
  DiffHunk,
  FileDeltaEntry,
  FileDiff,
  FileEntry,
  FilesDelta,
} from "../types";
import { buildFileDiff } from "../types";

/**
 * Merging a watcher delta into the diff already on screen.
 *
 * The whole point of the incremental path is that these are *patches*, not a
 * new answer: everything not named by the delta keeps its previous object
 * identity, so a viewer subscribed to some other file doesn't re-render
 * because an agent saved a file across the repo. The two halves are separate
 * because they patch two different shapes — `filesByPath` is flat and keyed by
 * path, while `files` is the working tree as a tree.
 */

/** The result of folding a delta's hunks into a `filesByPath` map. */
export interface MergedFileDiffs {
  filesByPath: Record<string, FileDiff>;
  /**
   * Hunk ids that exist after the merge and did not before. These are the only
   * hunks that can need classifying — every other id already had its answer.
   */
  addedHunkIds: string[];
  /** Whether any file's hunks changed, including files dropping out entirely. */
  changed: boolean;
}

/**
 * Replace the delta's files in `prev`, dropping the ones that are no longer
 * part of the comparison.
 *
 * A file whose content came back byte-identical keeps its previous `FileDiff`
 * object — the watcher fires for saves that changed nothing the diff can see
 * (a touch, a reformat that git already had), and those must not invalidate
 * the viewer.
 */
export function mergeDeltaHunks(
  prev: Record<string, FileDiff>,
  delta: FilesDelta,
): MergedFileDiffs {
  const freshByPath: Record<string, DiffHunk[]> = {};
  for (const hunk of delta.hunks) {
    (freshByPath[hunk.filePath] ??= []).push(hunk);
  }

  const next = { ...prev };
  const addedHunkIds: string[] = [];
  let changed = false;

  for (const file of delta.files) {
    const freshHunks = freshByPath[file.path];
    const existing = prev[file.path];

    if (!freshHunks || freshHunks.length === 0) {
      // No hunks left: the edit put the file back the way the base has it.
      if (existing) {
        delete next[file.path];
        changed = true;
      }
      continue;
    }

    const fresh = buildFileDiff(freshHunks);
    if (existing && existing.contentHash === fresh.contentHash) continue;

    const knownIds = new Set(existing?.hunks.map((h) => h.id) ?? []);
    for (const hunk of freshHunks) {
      if (!knownIds.has(hunk.id)) addedHunkIds.push(hunk.id);
    }
    next[file.path] = fresh;
    changed = true;
  }

  return { filesByPath: next, addedHunkIds, changed };
}

/** The result of patching the file tree. */
export interface PatchedFileTree {
  entries: FileEntry[];
  /** Whether the tree's shape or any entry's status actually moved. */
  changed: boolean;
}

/**
 * Fold the delta's file-list identity into the working-tree file tree.
 *
 * The tree covers every file in the working tree with only the changed ones
 * marked, so three things can happen to a path: its status changes (an edit
 * that made it part of the comparison, or one that took it back out), it
 * appears (a file the agent just created), or it disappears (an untracked file
 * deleted again). Anything else leaves the tree exactly as it was — including
 * its object identity, so `FilesPanel` doesn't re-render for a no-op save.
 */
export function patchFileTree(
  entries: FileEntry[],
  files: FileDeltaEntry[],
): PatchedFileTree {
  let next = entries;
  let changed = false;

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    // A path that is neither part of the comparison nor on disk is one the
    // tree should forget; everything else belongs in it.
    const result =
      file.status === undefined && !file.exists
        ? removeNode(next, segments, 0)
        : upsertNode(next, segments, 0, file);

    if (result.changed) {
      next = result.entries;
      changed = true;
    }
  }

  return { entries: next, changed };
}

/** Directories first, then case-insensitively by name — `build_file_tree`'s order. */
function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function insertSorted(entries: FileEntry[], entry: FileEntry): FileEntry[] {
  const next = [...entries];
  const at = next.findIndex((e) => compareEntries(entry, e) < 0);
  next.splice(at === -1 ? next.length : at, 0, entry);
  return next;
}

/** Build the chain of directory entries a not-yet-present file needs. */
function makeBranch(
  segments: string[],
  depth: number,
  file: FileDeltaEntry,
): FileEntry {
  const path = segments.slice(0, depth + 1).join("/");
  const name = segments[depth];
  if (depth === segments.length - 1) {
    return {
      name,
      path,
      isDirectory: false,
      status: file.status,
      ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
    };
  }
  return {
    name,
    path,
    isDirectory: true,
    children: [makeBranch(segments, depth + 1, file)],
  };
}

function upsertNode(
  entries: FileEntry[],
  segments: string[],
  depth: number,
  file: FileDeltaEntry,
): PatchedFileTree {
  const path = segments.slice(0, depth + 1).join("/");
  const index = entries.findIndex((e) => e.path === path);
  const isLeaf = depth === segments.length - 1;

  if (index === -1) {
    return {
      entries: insertSorted(entries, makeBranch(segments, depth, file)),
      changed: true,
    };
  }

  const node = entries[index];

  if (isLeaf) {
    const renamedFrom = file.renamedFrom ?? undefined;
    if (node.status === file.status && node.renamedFrom === renamedFrom) {
      return { entries, changed: false };
    }
    const next = [...entries];
    next[index] = { ...node, status: file.status, renamedFrom };
    return { entries: next, changed: true };
  }

  const patched = upsertNode(node.children ?? [], segments, depth + 1, file);
  if (!patched.changed) return { entries, changed: false };

  const next = [...entries];
  next[index] = { ...node, children: patched.entries };
  return { entries: next, changed: true };
}

function removeNode(
  entries: FileEntry[],
  segments: string[],
  depth: number,
): PatchedFileTree {
  const path = segments.slice(0, depth + 1).join("/");
  const index = entries.findIndex((e) => e.path === path);
  if (index === -1) return { entries, changed: false };

  if (depth === segments.length - 1) {
    return {
      entries: entries.filter((_, i) => i !== index),
      changed: true,
    };
  }

  const node = entries[index];
  const patched = removeNode(node.children ?? [], segments, depth + 1);
  if (!patched.changed) return { entries, changed: false };

  // A directory only exists in this tree because of the files under it, so one
  // that just lost its last child goes with them.
  if (patched.entries.length === 0) {
    return { entries: entries.filter((_, i) => i !== index), changed: true };
  }

  const next = [...entries];
  next[index] = { ...node, children: patched.entries };
  return { entries: next, changed: true };
}
