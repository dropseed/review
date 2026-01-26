/**
 * Prompt building for Claude classification.
 * Ported from Python human_review/cli.py:_build_classify_prompt()
 */

import type { ChangedFile, DiffHunk } from "../state/types";
import { TRUST_PATTERNS } from "../trust/patterns";
import { getHunkKey } from "../utils/hash";

/**
 * Build the diff content for classification.
 */
export function buildDiffContent(
  hunksToClassify: Array<{ file: ChangedFile; hunk: DiffHunk; hunkKey: string }>,
): string {
  const lines: string[] = [];

  for (const { file, hunk, hunkKey } of hunksToClassify) {
    lines.push(`=== ${hunkKey} ===`);
    lines.push(`File: ${file.path} (${file.status})`);
    lines.push(hunk.header);
    lines.push(hunk.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build the full classification prompt for Claude.
 */
export function buildClassifyPrompt(diffContent: string): string {
  // Build pattern list
  const patternList = Object.values(TRUST_PATTERNS)
    .map((p) => `- \`${p.id}\` — ${p.description}`)
    .join("\n");

  return `Classify each hunk in this diff. For each hunk, provide:
1. **label**: Array of trust patterns from the taxonomy (can be empty if no patterns apply)
2. **reasoning**: Brief explanation of what the change does

## Trust Patterns Taxonomy

Only use patterns from this list. Leave label empty if no patterns apply.

${patternList}

## Rules

- Apply patterns ONLY when they FULLY describe the change
- If a hunk has mixed changes (e.g., imports + logic), leave label empty
- Multiple patterns are allowed if the hunk combines trustable changes
- Reasoning should be specific and clear (e.g., "Added import for ChoicesFieldMixin")

## Output Format

Return a JSON object mapping hunk_key to classification:

\`\`\`json
{
  "filepath:hash": {
    "label": ["pattern:id"],
    "reasoning": "Brief explanation"
  }
}
\`\`\`

## Diff to Classify

${diffContent}

Return ONLY the JSON object, no other text.`;
}

/**
 * Get unlabeled hunks from files that need classification.
 */
export function getUnlabeledHunks(
  files: ChangedFile[],
  hunks: Record<string, { reasoning: string | null }>,
): Array<{ file: ChangedFile; hunk: DiffHunk; hunkKey: string }> {
  const unlabeled: Array<{ file: ChangedFile; hunk: DiffHunk; hunkKey: string }> = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
      const hunkState = hunks[hunkKey];
      if (!hunkState || hunkState.reasoning === null) {
        unlabeled.push({ file, hunk, hunkKey });
      }
    }
  }

  return unlabeled;
}
