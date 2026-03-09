export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  content: string;
  hasFrontmatter: boolean;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Browser-safe — no Node dependencies.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: raw, hasFrontmatter: false };
  }

  const yamlBlock = match[1];
  const content = match[2];
  const frontmatter = parseSimpleYaml(yamlBlock);
  const hasFrontmatter = Object.keys(frontmatter).length > 0;

  return { frontmatter, content, hasFrontmatter };
}

/** Parse simple single-level YAML (covers typical frontmatter). */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let listItems: string[] | null = null;

  for (const line of yaml.split("\n")) {
    // List continuation: "  - value"
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey && listItems !== null) {
      listItems.push(parseValue(listMatch[1]));
      continue;
    }

    // Flush any pending list
    if (currentKey && listItems !== null) {
      result[currentKey] = listItems;
      listItems = null;
      currentKey = null;
    }

    // Key-value pair: "key: value" or "key:"
    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    if (rawValue === "") {
      // Could be start of a list or empty value
      currentKey = key;
      listItems = [];
    } else {
      result[key] = parseValue(rawValue);
      currentKey = key;
    }
  }

  // Flush trailing list
  if (currentKey && listItems !== null) {
    if (listItems.length > 0) {
      result[currentKey] = listItems;
    }
  }

  return result;
}

function parseValue(raw: string): string {
  // Strip surrounding quotes
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  // Inline list: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw; // keep as string, FrontmatterCard will display it
  }
  return raw;
}
