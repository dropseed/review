/**
 * Trust patterns taxonomy for human-review.
 * Ported from Python human_review/patterns.py
 *
 * This module defines the core trust patterns that can be recognized and
 * auto-approved during code review. These patterns represent mechanical,
 * patterned changes that don't require human judgment.
 *
 * Key insight: We're not categorizing ALL changes. We're identifying changes
 * that fit known trustable patterns. Everything else needs review.
 */

/**
 * Definition of a trust pattern.
 */
export interface TrustPattern {
  id: string;
  description: string;
}

/**
 * Core trust patterns taxonomy (~20 patterns).
 * These are ONLY for trustable/mechanical/patterned changes.
 */
export const TRUST_PATTERNS: Record<string, TrustPattern> = {
  // Imports
  "imports:added": { id: "imports:added", description: "Import statements added" },
  "imports:removed": { id: "imports:removed", description: "Import statements removed" },
  "imports:reordered": { id: "imports:reordered", description: "Imports reordered/reorganized" },

  // Formatting
  "formatting:whitespace": {
    id: "formatting:whitespace",
    description: "Whitespace changes (spaces, tabs, blank lines)",
  },
  "formatting:line-length": {
    id: "formatting:line-length",
    description: "Line wrapping/length changes",
  },
  "formatting:style": {
    id: "formatting:style",
    description: "Code style (quotes, trailing commas, etc.)",
  },

  // Comments
  "comments:added": { id: "comments:added", description: "Comments added" },
  "comments:removed": { id: "comments:removed", description: "Comments removed" },
  "comments:modified": { id: "comments:modified", description: "Comments changed" },

  // Types & Annotations
  "types:added": { id: "types:added", description: "Type annotations added (no logic change)" },
  "types:removed": { id: "types:removed", description: "Type annotations removed" },
  "types:modified": { id: "types:modified", description: "Type annotations changed" },

  // Files
  "file:deleted": { id: "file:deleted", description: "File deleted entirely" },
  "file:renamed": { id: "file:renamed", description: "File renamed (content unchanged)" },
  "file:moved": { id: "file:moved", description: "File moved to different directory" },

  // Code Movement & Renames (unchanged logic)
  "code:relocated": {
    id: "code:relocated",
    description: "Code relocated with no behavior change (reordering, not new class/scope)",
  },
  "rename:variable": { id: "rename:variable", description: "Variable/constant renamed" },
  "rename:function": { id: "rename:function", description: "Function renamed" },
  "rename:class": { id: "rename:class", description: "Class renamed" },
  "rename:parameter": { id: "rename:parameter", description: "Parameter renamed" },

  // Generated & Mechanical
  "generated:lockfile": {
    id: "generated:lockfile",
    description: "Package lock file (package-lock.json, uv.lock, etc.)",
  },
  "generated:config": { id: "generated:config", description: "Auto-generated configuration" },
  "generated:migration": { id: "generated:migration", description: "Database migration files" },
  "version:bumped": { id: "version:bumped", description: "Version number changed" },

  // Removal
  "remove:deprecated": { id: "remove:deprecated", description: "Deprecated code removed" },
};

/**
 * Get a pattern by ID.
 */
export function getPattern(patternId: string): TrustPattern | undefined {
  return TRUST_PATTERNS[patternId];
}

/**
 * Check if a pattern ID is valid (exists in taxonomy or is custom:*).
 */
export function isValidPattern(patternId: string): boolean {
  if (patternId in TRUST_PATTERNS) {
    return true;
  }
  // Allow custom patterns (custom:whatever)
  if (patternId.startsWith("custom:")) {
    return true;
  }
  return false;
}

/**
 * Get all registered patterns.
 */
export function getAllPatterns(): TrustPattern[] {
  return Object.values(TRUST_PATTERNS);
}

/**
 * Extract the category from a pattern ID (the part before the colon).
 */
export function getCategory(patternId: string): string {
  if (patternId.includes(":")) {
    return patternId.split(":")[0];
  }
  return patternId;
}

/**
 * Get the description for a pattern ID.
 */
export function getPatternDescription(patternId: string): string {
  const pattern = TRUST_PATTERNS[patternId];
  if (pattern) {
    return pattern.description;
  }
  if (patternId.startsWith("custom:")) {
    return `Custom pattern: ${patternId.slice(7)}`;
  }
  return patternId;
}

/**
 * Format a list of patterns for display.
 */
export function formatPatternList(patterns: string[]): string {
  if (patterns.length === 0) {
    return "(no patterns)";
  }
  return patterns.join(", ");
}
