import type { FileEntry, ReviewState } from "../../types";
import { isHunkTrusted } from "../../types";
import type { FileHunkStatus, ProcessedFileEntry, ViewMode } from "./types";

export const EMPTY_HUNK_STATUS: FileHunkStatus = {
  pending: 0,
  approved: 0,
  trusted: 0,
  rejected: 0,
  total: 0,
};

// Check if an entry has a meaningful change status (not just gitignored or unchanged)
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

// Calculate hunk status for each file
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

// Process tree with review status
export function processTree(
  entries: FileEntry[],
  hunkStatusMap: Map<string, FileHunkStatus>,
  viewMode: ViewMode,
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
        aggregateStatus.total += child.hunkStatus.total;
      }

      const ownStatusChanged = hasChangeStatus(entry.status);

      // Directory matches filter if any child matches OR it has its own status change
      const anyChildMatches = processedChildren.some((c) => c.matchesFilter);
      const matchesFilter =
        viewMode === "all" ||
        (viewMode === "changes" && (anyChildMatches || ownStatusChanged));

      const fileCount = processedChildren.reduce(
        (sum, child) => sum + (child.isDirectory ? child.fileCount : 1),
        0,
      );

      return {
        ...entry,
        children: processedChildren,
        hunkStatus: aggregateStatus,
        hasChanges: aggregateStatus.total > 0 || ownStatusChanged,
        matchesFilter,
        displayName: entry.name,
        compactedPaths: [entry.path],
        fileCount,
        siblingMaxFileCount: 0,
      };
    }

    // File node
    const hunkStatus = fileStatus ?? { ...EMPTY_HUNK_STATUS };
    const hasChanges = hunkStatus.total > 0 || hasChangeStatus(entry.status);

    // Filter based on view mode
    // In "all" mode, exclude deleted files since they don't exist in the current state
    const matchesFilter =
      (viewMode === "all" && entry.status !== "deleted") ||
      (viewMode === "changes" && hasChanges);

    return {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      status: entry.status,
      hunkStatus,
      hasChanges,
      matchesFilter,
      displayName: entry.name,
      compactedPaths: [entry.path],
      fileCount: 0,
      siblingMaxFileCount: 0,
    };
  }

  const processed = entries.map(process);
  return annotateSiblingMax(compactTree(processed));
}

// Result type for sectioned tree processing
export interface SectionedTreeResult {
  needsReview: ProcessedFileEntry[];
  reviewed: ProcessedFileEntry[];
}

// Process tree and split into "needs review" and "reviewed" sections
// Used for the "Changes" view mode to separate pending vs reviewed files
export function processTreeWithSections(
  entries: FileEntry[],
  hunkStatusMap: Map<string, FileHunkStatus>,
): SectionedTreeResult {
  // First process the full tree for "changes" view
  const processed = processTree(entries, hunkStatusMap, "changes");

  // Helper to filter tree by section
  function filterSection(
    entries: ProcessedFileEntry[],
    filterFn: (status: FileHunkStatus, entry: ProcessedFileEntry) => boolean,
  ): ProcessedFileEntry[] {
    return entries
      .map((entry) => {
        if (!entry.matchesFilter) return null;

        if (entry.isDirectory && entry.children) {
          const filteredChildren = filterSection(entry.children, filterFn);

          // Directory should be included if any children remain OR it has its own status change
          if (filteredChildren.length === 0 && !hasChangeStatus(entry.status))
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

  // Needs review: files with pending hunks, or status changes with no hunks (e.g., symlinks)
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

  // Reviewed: files with any reviewed hunks (approved, trusted, or rejected)
  const reviewed = annotateSiblingMax(
    compactTree(
      filterSection(
        processed,
        (status) => status.approved + status.trusted + status.rejected > 0,
      ),
    ),
  );

  return { needsReview, reviewed };
}

// Annotate each directory entry with the max fileCount among its sibling directories
function annotateSiblingMax(
  entries: ProcessedFileEntry[],
): ProcessedFileEntry[] {
  const maxFileCount = entries.reduce(
    (max, e) => (e.isDirectory && e.fileCount > max ? e.fileCount : max),
    0,
  );

  return entries.map((entry) => {
    if (!entry.isDirectory) return entry;

    const annotatedChildren = entry.children
      ? annotateSiblingMax(entry.children)
      : undefined;

    return {
      ...entry,
      siblingMaxFileCount: maxFileCount,
      children: annotatedChildren,
    };
  });
}

// Compact single-child directory chains
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
