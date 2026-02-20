import type { SearchMatch } from "../types";

export interface GroupedSearchResults {
  filePath: string;
  matches: SearchMatch[];
}

/** Groups flat search results by file path, preserving order of first appearance. */
export function groupSearchResultsByFile(
  results: SearchMatch[],
): GroupedSearchResults[] {
  const groups = new Map<string, GroupedSearchResults>();

  for (const result of results) {
    const existing = groups.get(result.filePath);
    if (existing) {
      existing.matches.push(result);
    } else {
      groups.set(result.filePath, {
        filePath: result.filePath,
        matches: [result],
      });
    }
  }

  return Array.from(groups.values());
}
