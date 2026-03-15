import { parse } from "yaml";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  content: string;
  hasFrontmatter: boolean;
}

/**
 * Parse YAML frontmatter from markdown content.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: raw, hasFrontmatter: false };
  }

  const yamlBlock = match[1];
  const content = match[2];

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parse(yamlBlock);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed;
    }
  } catch {
    // Invalid YAML — treat as no frontmatter
  }

  const hasFrontmatter = Object.keys(frontmatter).length > 0;
  return { frontmatter, content, hasFrontmatter };
}
