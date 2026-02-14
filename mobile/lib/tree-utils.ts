import type { FileEntry } from "../api/types";

/**
 * Compact single-child directory chains.
 * e.g., `src` → `components` → `FileViewer/` becomes `src/components/FileViewer/`
 */
export function compactTree(entries: FileEntry[]): FileEntry[] {
  return entries.map((entry) => {
    if (!entry.isDirectory || !entry.children) {
      return entry;
    }

    let compacted: FileEntry = {
      ...entry,
      children: compactTree(entry.children),
    };

    while (
      compacted.children &&
      compacted.children.length === 1 &&
      compacted.children[0].isDirectory &&
      !compacted.children[0].status
    ) {
      const onlyChild = compacted.children[0];
      compacted = {
        ...compacted,
        name: `${compacted.name}/${onlyChild.name}`,
        path: onlyChild.path,
        children: onlyChild.children,
      };
    }

    return compacted;
  });
}

/** Count all non-directory files in a tree recursively */
export function countFiles(entries: FileEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory && entry.children) {
      count += countFiles(entry.children);
    } else if (!entry.isDirectory) {
      count++;
    }
  }
  return count;
}

/** Get top-level directory paths for default expanded state */
export function getTopLevelDirPaths(entries: FileEntry[]): string[] {
  return entries
    .filter((e) => e.isDirectory)
    .map((e) => e.path);
}
