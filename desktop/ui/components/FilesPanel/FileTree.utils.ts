import type { FileEntry, ReviewState, StatusEntry } from "../../types";
import { isHunkTrusted } from "../../types";
import type { FileSortOrder } from "../../stores/slices/preferencesSlice";
import type {
  FileHunkStatus,
  ProcessedFileEntry,
  FilesPanelTab,
} from "./types";

export const EMPTY_HUNK_STATUS: FileHunkStatus = {
  pending: 0,
  approved: 0,
  trusted: 0,
  rejected: 0,
  savedForLater: 0,
  total: 0,
};

export function hasChangeStatus(
  status: FileEntry["status"] | undefined,
): boolean {
  return (
    status === "added" ||
    status === "modified" ||
    status === "deleted" ||
    status === "renamed" ||
    status === "untracked"
  );
}

export function calculateFileHunkStatus(
  hunks: Array<{ id: string; filePath: string }>,
  reviewState: ReviewState | null,
  options?: {
    autoApproveStaged?: boolean;
    stagedFilePaths?: Set<string>;
  },
): Map<string, FileHunkStatus> {
  const statusMap = new Map<string, FileHunkStatus>();

  for (const hunk of hunks) {
    const current = statusMap.get(hunk.filePath) ?? { ...EMPTY_HUNK_STATUS };

    const hunkState = reviewState?.hunks[hunk.id];
    const trustList = reviewState?.trustList ?? [];

    if (hunkState?.status === "rejected") {
      current.rejected++;
    } else if (hunkState?.status === "approved") {
      current.approved++;
    } else if (hunkState?.status === "saved_for_later") {
      current.savedForLater++;
    } else if (isHunkTrusted(hunkState, trustList)) {
      current.trusted++;
    } else if (
      options?.autoApproveStaged &&
      options.stagedFilePaths?.has(hunk.filePath)
    ) {
      current.trusted++;
    } else {
      current.pending++;
    }
    current.total++;
    statusMap.set(hunk.filePath, current);
  }

  return statusMap;
}

/** Collect all leaf (file) statuses from a processed tree. */
function collectLeafStatuses(
  entries: ProcessedFileEntry[],
): Set<FileEntry["status"]> {
  const statuses = new Set<FileEntry["status"]>();
  for (const entry of entries) {
    if (!entry.matchesFilter) continue;
    if (entry.isDirectory && entry.children) {
      for (const s of collectLeafStatuses(entry.children)) {
        statuses.add(s);
      }
    } else if (entry.status) {
      statuses.add(entry.status);
    }
  }
  return statuses;
}

/**
 * If every leaf descendant shares the same change status, return it.
 * Otherwise return undefined.
 */
function computeRolledUpStatus(
  children: ProcessedFileEntry[],
): FileEntry["status"] | undefined {
  const statuses = collectLeafStatuses(children);
  if (statuses.size === 1) {
    const [only] = statuses;
    if (hasChangeStatus(only)) return only;
  }
  return undefined;
}

/**
 * For a renamed directory, compute the common old-dir prefix from children's renamedFrom.
 * Returns the old directory path if all children share one, otherwise undefined.
 *
 * For each leaf, strips the current dir prefix from the new path and the
 * equivalent suffix from the old path to derive the old directory.
 * E.g., new: "src/new/foo.ts", old: "src/old/foo.ts", dirPath: "src/new"
 *   -> suffix: "foo.ts" -> old dir: "src/old"
 */
function computeRolledUpRenamedFrom(
  children: ProcessedFileEntry[],
  dirPath: string,
): string | undefined {
  const dirPrefix = dirPath + "/";
  const oldDirCandidates = new Set<string>();

  function collect(entries: ProcessedFileEntry[]) {
    for (const entry of entries) {
      if (!entry.matchesFilter) continue;
      if (entry.isDirectory && entry.children) {
        if (entry.renamedFrom) {
          oldDirCandidates.add(entry.renamedFrom);
        } else {
          collect(entry.children);
        }
      } else if (entry.renamedFrom && entry.path.startsWith(dirPrefix)) {
        const suffix = entry.path.slice(dirPrefix.length);
        if (entry.renamedFrom.endsWith("/" + suffix)) {
          oldDirCandidates.add(
            entry.renamedFrom.slice(
              0,
              entry.renamedFrom.length - suffix.length - 1,
            ),
          );
        }
      }
    }
  }
  collect(children);

  if (oldDirCandidates.size === 1) {
    const [oldDir] = oldDirCandidates;
    return oldDir;
  }

  return undefined;
}

export function processTree(
  entries: FileEntry[],
  hunkStatusMap: Map<string, FileHunkStatus>,
  viewMode: FilesPanelTab,
  sortOrder?: FileSortOrder,
): ProcessedFileEntry[] {
  function process(entry: FileEntry): ProcessedFileEntry {
    const fileStatus = hunkStatusMap.get(entry.path);

    // Symlink directories are leaf entries in "changes" mode
    // (in git, a symlink is a single committable entry regardless of target type)
    const isSymlinkInChanges = entry.isSymlink && viewMode === "changes";

    if (entry.isDirectory && entry.children && !isSymlinkInChanges) {
      const processedChildren = entry.children.map(process);

      // Aggregate hunk status from children
      const aggregateStatus: FileHunkStatus = { ...EMPTY_HUNK_STATUS };
      for (const child of processedChildren) {
        aggregateStatus.pending += child.hunkStatus.pending;
        aggregateStatus.approved += child.hunkStatus.approved;
        aggregateStatus.trusted += child.hunkStatus.trusted;
        aggregateStatus.rejected += child.hunkStatus.rejected;
        aggregateStatus.savedForLater += child.hunkStatus.savedForLater;
        aggregateStatus.total += child.hunkStatus.total;
      }

      // Compute rolled-up status in changes mode only (browse is for navigating, not reviewing)
      const rolledUpStatus =
        viewMode === "changes"
          ? computeRolledUpStatus(processedChildren)
          : undefined;
      const rolledUpRenamedFrom =
        rolledUpStatus === "renamed"
          ? computeRolledUpRenamedFrom(processedChildren, entry.path)
          : undefined;

      const rawStatus = entry.status ?? rolledUpStatus;
      // In browse mode, strip change-statuses so status indicators don't render
      const effectiveStatus =
        viewMode === "browse" && hasChangeStatus(rawStatus)
          ? undefined
          : rawStatus;
      const ownStatusChanged = hasChangeStatus(effectiveStatus);

      // Directory matches filter if any child matches OR it has its own status change
      const anyChildMatches = processedChildren.some((c) => c.matchesFilter);
      const matchesFilter =
        viewMode === "browse" ||
        (viewMode === "changes" && (anyChildMatches || ownStatusChanged));

      const fileCount = processedChildren.reduce(
        (sum, child) => sum + (child.isDirectory ? child.fileCount : 1),
        0,
      );

      const totalSize = processedChildren.reduce(
        (sum, c) => sum + c.totalSize,
        0,
      );
      const latestModified = processedChildren.reduce(
        (max, c) => Math.max(max, c.latestModified),
        0,
      );

      return {
        ...entry,
        status: effectiveStatus,
        renamedFrom: entry.renamedFrom ?? rolledUpRenamedFrom,
        children: processedChildren,
        hunkStatus: aggregateStatus,
        hasChanges: aggregateStatus.total > 0 || ownStatusChanged,
        matchesFilter,
        displayName: entry.name,
        compactedPaths: [entry.path],
        fileCount,
        siblingMaxFileCount: 0,
        totalSize,
        siblingMaxSize: 0,
        latestModified,
      };
    }

    // File node
    const hunkStatus = fileStatus ?? { ...EMPTY_HUNK_STATUS };
    const hasChanges = hunkStatus.total > 0 || hasChangeStatus(entry.status);

    // Filter based on view mode
    // In browse mode, exclude deleted files since they don't exist in the current state
    const matchesFilter =
      (viewMode === "browse" && entry.status !== "deleted") ||
      (viewMode === "changes" && hasChanges);

    // In browse mode, strip change-statuses so status indicators don't render
    const effectiveFileStatus =
      viewMode === "browse" && hasChangeStatus(entry.status)
        ? undefined
        : entry.status;

    return {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      status: effectiveFileStatus,
      renamedFrom: viewMode === "browse" ? undefined : entry.renamedFrom,
      hunkStatus,
      hasChanges,
      matchesFilter,
      displayName: entry.name,
      compactedPaths: [entry.path],
      fileCount: 0,
      siblingMaxFileCount: 0,
      totalSize: entry.size ?? 0,
      siblingMaxSize: 0,
      latestModified: entry.modifiedAt ?? 0,
    };
  }

  let processed = entries.map(process);
  if (sortOrder && sortOrder !== "name") {
    processed = sortTree(processed, sortOrder);
  }
  return annotateSiblingMax(compactTree(processed));
}

export interface SectionedTreeResult {
  needsReview: ProcessedFileEntry[];
  savedForLater: ProcessedFileEntry[];
  reviewed: ProcessedFileEntry[];
}

/** Process tree and split into needs-review, saved-for-later, and reviewed sections. */
export function processTreeWithSections(
  entries: FileEntry[],
  hunkStatusMap: Map<string, FileHunkStatus>,
  sortOrder?: FileSortOrder,
): SectionedTreeResult {
  const processed = processTree(entries, hunkStatusMap, "changes", sortOrder);

  function filterSection(
    entries: ProcessedFileEntry[],
    filterFn: (status: FileHunkStatus, entry: ProcessedFileEntry) => boolean,
  ): ProcessedFileEntry[] {
    return entries
      .map((entry) => {
        if (!entry.matchesFilter) return null;

        if (entry.isDirectory && entry.children) {
          const filteredChildren = filterSection(entry.children, filterFn);

          // Directory should be included if any children remain OR it's a symlink with its own status change
          // (Rolled-up status from children is for display only, not section inclusion)
          if (
            filteredChildren.length === 0 &&
            !(entry.isSymlink && hasChangeStatus(entry.status))
          )
            return null;

          return {
            ...entry,
            children: filteredChildren,
          };
        }

        // File node - check if it belongs in this section
        if (!filterFn(entry.hunkStatus, entry)) return null;
        return entry;
      })
      .filter((e): e is ProcessedFileEntry => e !== null);
  }

  const needsReview = annotateSiblingMax(
    compactTree(
      filterSection(processed, (status, entry) => {
        if (status.pending > 0) return true;
        // Entries with status changes but no hunks are implicitly pending
        if (status.total === 0 && entry.hasChanges) return true;
        return false;
      }),
    ),
  );

  const savedForLater = annotateSiblingMax(
    compactTree(filterSection(processed, (status) => status.savedForLater > 0)),
  );

  const reviewed = annotateSiblingMax(
    compactTree(
      filterSection(
        processed,
        (status) => status.approved + status.trusted + status.rejected > 0,
      ),
    ),
  );

  return { needsReview, savedForLater, reviewed };
}

function annotateSiblingMax(
  entries: ProcessedFileEntry[],
): ProcessedFileEntry[] {
  const maxFileCount = entries.reduce(
    (max, e) => (e.isDirectory && e.fileCount > max ? e.fileCount : max),
    0,
  );
  const maxSize = entries.reduce(
    (max, e) => (e.totalSize > max ? e.totalSize : max),
    0,
  );

  return entries.map((entry) => {
    const annotatedChildren = entry.children
      ? annotateSiblingMax(entry.children)
      : undefined;

    return {
      ...entry,
      siblingMaxFileCount: entry.isDirectory
        ? maxFileCount
        : entry.siblingMaxFileCount,
      siblingMaxSize: maxSize,
      children: annotatedChildren,
    };
  });
}

function sortTree(
  entries: ProcessedFileEntry[],
  order: FileSortOrder,
): ProcessedFileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Directories first, always
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    switch (order) {
      case "size":
        return (
          b.totalSize - a.totalSize ||
          a.displayName.localeCompare(b.displayName)
        );
      case "modified":
        return (
          b.latestModified - a.latestModified ||
          a.displayName.localeCompare(b.displayName)
        );
      default:
        return a.displayName.localeCompare(b.displayName);
    }
  });
  return sorted.map((e) =>
    e.children ? { ...e, children: sortTree(e.children, order) } : e,
  );
}

export function compactTree(
  entries: ProcessedFileEntry[],
): ProcessedFileEntry[] {
  return entries.map((entry) => {
    if (!entry.isDirectory || !entry.children) {
      return entry;
    }

    let compacted: ProcessedFileEntry = {
      ...entry,
      children: compactTree(entry.children),
    };

    while (
      compacted.children &&
      compacted.children.length === 1 &&
      compacted.children[0].isDirectory &&
      // Don't compact symlinks or directories with their own status (preserve visual indicators)
      !compacted.children[0].isSymlink &&
      !compacted.children[0].status
    ) {
      const onlyChild = compacted.children[0];
      compacted = {
        ...compacted,
        displayName: `${compacted.displayName}/${onlyChild.displayName}`,
        compactedPaths: [
          ...compacted.compactedPaths,
          ...onlyChild.compactedPaths,
        ],
        children: onlyChild.children,
        path: onlyChild.path,
        fileCount: onlyChild.fileCount,
      };
    }

    return compacted;
  });
}

/** Build a FileEntry[] tree from flat file paths with optional status. */
export function buildFileTreeFromPaths(
  files: Array<{ path: string; status?: StatusEntry["status"] }>,
): FileEntry[] {
  // Map: dir path → children map (name → FileEntry)
  const dirMap = new Map<string, Map<string, FileEntry>>();
  dirMap.set("", new Map());

  for (const file of files) {
    const segments = file.path.split("/");
    let currentDir = "";

    // Ensure all intermediate directories exist
    for (let i = 0; i < segments.length - 1; i++) {
      const parentDir = currentDir;
      currentDir = currentDir ? `${currentDir}/${segments[i]}` : segments[i];

      if (!dirMap.has(currentDir)) {
        dirMap.set(currentDir, new Map());
        const parentChildren = dirMap.get(parentDir)!;
        if (!parentChildren.has(segments[i])) {
          parentChildren.set(segments[i], {
            name: segments[i],
            path: currentDir,
            isDirectory: true,
            children: [],
          });
        }
      }
    }

    // Add the file entry
    const fileName = segments[segments.length - 1];
    const parentChildren = dirMap.get(currentDir)!;
    parentChildren.set(fileName, {
      name: fileName,
      path: file.path,
      isDirectory: false,
      status: file.status,
    });
  }

  // Build trees from the maps
  function buildChildren(dirPath: string): FileEntry[] {
    const children = dirMap.get(dirPath);
    if (!children) return [];

    const result: FileEntry[] = [];
    for (const entry of children.values()) {
      if (entry.isDirectory) {
        result.push({
          ...entry,
          children: buildChildren(entry.path),
        });
      } else {
        result.push(entry);
      }
    }

    // Sort: directories first, then alphabetical
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  return buildChildren("");
}
