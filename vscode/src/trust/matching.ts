/**
 * Pattern matching for trust patterns.
 * Ported from Python human_review/patterns.py (fnmatch-based matching)
 */

/**
 * Check if a pattern ID matches a glob pattern.
 *
 * Examples:
 *   patternMatchesGlob("imports:added", "imports:*") -> true
 *   patternMatchesGlob("imports:added", "imports:added") -> true
 *   patternMatchesGlob("imports:added", "*:added") -> true
 *   patternMatchesGlob("imports:added", "formatting:*") -> false
 */
export function patternMatchesGlob(patternId: string, globPattern: string): boolean {
  // Exact match
  if (patternId === globPattern) {
    return true;
  }

  // No wildcard, must be exact match
  if (!globPattern.includes("*")) {
    return false;
  }

  // Convert glob pattern to regex
  // Escape special regex chars except *, then convert * to .*
  const escaped = globPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*"); // Convert * to .*

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(patternId);
}

/**
 * Check if all patterns are trusted by the trust list.
 *
 * @param patterns - List of pattern IDs from a hunk (e.g., ["imports:added"])
 * @param trustList - User's configured trust patterns (e.g., ["imports:*", "formatting:*"])
 * @returns Object with allTrusted boolean and list of untrusted patterns
 */
export function patternsMatchTrustList(
  patterns: string[],
  trustList: string[],
): { allTrusted: boolean; untrustedPatterns: string[] } {
  if (patterns.length === 0) {
    // Empty patterns = needs review (no trustable pattern recognized)
    return { allTrusted: false, untrustedPatterns: [] };
  }

  const untrusted: string[] = [];
  for (const pattern of patterns) {
    const isTrusted = trustList.some((trusted) => patternMatchesGlob(pattern, trusted));
    if (!isTrusted) {
      untrusted.push(pattern);
    }
  }

  return { allTrusted: untrusted.length === 0, untrustedPatterns: untrusted };
}

/**
 * Check if a label matches any pattern in the trust list.
 */
export function isLabelTrusted(label: string, trustList: string[]): boolean {
  return trustList.some((pattern) => patternMatchesGlob(label, pattern));
}
