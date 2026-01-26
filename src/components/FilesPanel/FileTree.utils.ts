import type { FileEntry, ReviewState } from "../../types";
import { isHunkTrusted } from "../../types";
import type { FileHunkStatus, ProcessedFileEntry, ViewMode } from "./types";

// Calculate hunk status for each file
export function calculateFileHunkStatus(
  hunks: Array<{ id: string; filePath: string }>,
  reviewState: ReviewState | null,
): Map<string, FileHunkStatus> {
  const statusMap = new Map<string, FileHunkStatus>();

  for (const hunk of hunks) {
    const current = statusMap.get(hunk.filePath) ?? {
      pending: 0,
      approved: 0,
      trusted: 0,
      rejected: 0,
      total: 0,
    };

    const hunkState = reviewState?.hunks[hunk.id];
    const trustList = reviewState?.trustList ?? [];

    if (hunkState?.status === "rejected") {
      current.rejected++;
    } else if (hunkState?.status === "approved") {
      current.approved++;
    } else if (isHunkTrusted(hunkState, trustList)) {
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

    if (entry.isDirectory && entry.children) {
      const processedChildren = entry.children.map(process);

      // Aggregate hunk status from children
      const aggregateStatus: FileHunkStatus = {
        pending: 0,
        approved: 0,
        trusted: 0,
        rejected: 0,
        total: 0,
      };
      for (const child of processedChildren) {
        aggregateStatus.pending += child.hunkStatus.pending;
        aggregateStatus.approved += child.hunkStatus.approved;
        aggregateStatus.trusted += child.hunkStatus.trusted;
        aggregateStatus.rejected += child.hunkStatus.rejected;
        aggregateStatus.total += child.hunkStatus.total;
      }

      // Directory matches filter if any child matches
      const anyChildMatches = processedChildren.some((c) => c.matchesFilter);
      const matchesFilter = viewMode === "all" || anyChildMatches;

      return {
        ...entry,
        children: processedChildren,
        hunkStatus: aggregateStatus,
        hasChanges: aggregateStatus.total > 0,
        matchesFilter,
        displayName: entry.name,
        compactedPaths: [entry.path],
      };
    }

    // File node
    const hunkStatus = fileStatus ?? {
      pending: 0,
      approved: 0,
      trusted: 0,
      rejected: 0,
      total: 0,
    };

    // File has changes if it has hunks to review
    const hasChanges = hunkStatus.total > 0;

    // In changes mode, only show files with hunks
    const matchesFilter = viewMode === "all" || hasChanges;

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
    };
  }

  const processed = entries.map(process);
  return compactTree(processed);
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
      compacted.children[0].isDirectory
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
      };
    }

    return compacted;
  });
}
