/**
 * Simple glob-style pattern matching for trust patterns.
 * Supports:
 * - `*` matches any sequence of characters (within a segment)
 * - Exact matches
 *
 * Examples:
 * - `imports:*` matches `imports:added`, `imports:removed`
 * - `imports:added` matches only `imports:added`
 * - `*:removed` matches `imports:removed`, `comments:removed`
 */
export function matchesPattern(label: string, pattern: string): boolean {
  // If no wildcards, use exact match
  if (!pattern.includes("*")) {
    return label === pattern;
  }

  // Convert glob pattern to regex
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // Convert * to regex .*
  const regexPattern = escaped.replace(/\*/g, ".*");
  const regex = new RegExp(`^${regexPattern}$`);

  return regex.test(label);
}

/**
 * Check if a label matches any pattern in a list.
 */
export function matchesAnyPattern(label: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(label, pattern));
}

/**
 * Find the first pattern in a list that matches the label.
 */
export function findMatchingPattern(
  label: string,
  patterns: string[],
): string | undefined {
  return patterns.find((pattern) => matchesPattern(label, pattern));
}

/**
 * Check if any label in an array matches any pattern in a list.
 */
export function anyLabelMatchesAnyPattern(
  labels: string[],
  patterns: string[],
): boolean {
  return labels.some((label) => matchesAnyPattern(label, patterns));
}

/**
 * Check if any label in an array matches a specific pattern.
 */
export function anyLabelMatchesPattern(
  labels: string[],
  pattern: string,
): boolean {
  return labels.some((label) => matchesPattern(label, pattern));
}
