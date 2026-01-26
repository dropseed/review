import { useState, useEffect } from "react";
import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

// Map file extensions to Shiki language identifiers
const EXTENSION_TO_LANGUAGE: Record<string, BundledLanguage> = {
  // JavaScript/TypeScript
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  mjs: "javascript",
  cjs: "javascript",

  // Web
  html: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  vue: "vue",
  svelte: "svelte",

  // Config/Data
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",

  // Systems/Low-level
  rs: "rust",
  go: "go",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",

  // Scripting
  py: "python",
  rb: "ruby",
  php: "php",
  pl: "perl",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",

  // JVM
  java: "java",
  kt: "kotlin",
  scala: "scala",
  groovy: "groovy",

  // .NET
  cs: "csharp",
  fs: "fsharp",

  // Docs
  md: "markdown",
  mdx: "mdx",
  tex: "latex",
  rst: "rst",

  // Config files
  dockerfile: "dockerfile",
  makefile: "make",

  // Others
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  swift: "swift",
  r: "r",
  lua: "lua",
  vim: "viml",
  diff: "diff",
  ini: "ini",
  nginx: "nginx",
};

// Special filename mappings
const FILENAME_TO_LANGUAGE: Record<string, BundledLanguage> = {
  Dockerfile: "dockerfile",
  Makefile: "make",
  Cargo: "toml",
  Gemfile: "ruby",
  Rakefile: "ruby",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
};

let highlighterPromise: Promise<Highlighter> | null = null;

export function getLanguageFromFilename(filename: string): BundledLanguage | null {
  // Check special filenames first
  const basename = filename.split("/").pop() || filename;
  if (FILENAME_TO_LANGUAGE[basename]) {
    return FILENAME_TO_LANGUAGE[basename];
  }

  // Then check extension
  const ext = basename.split(".").pop()?.toLowerCase();
  if (ext && EXTENSION_TO_LANGUAGE[ext]) {
    return EXTENSION_TO_LANGUAGE[ext];
  }

  return null;
}

export function useHighlighter(): {
  highlighter: Highlighter | null;
  loading: boolean;
  error: Error | null;
} {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Reuse existing promise to avoid creating multiple highlighters
    if (!highlighterPromise) {
      highlighterPromise = createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: Object.values(EXTENSION_TO_LANGUAGE).filter(
          (value, index, self) => self.indexOf(value) === index
        ),
      });
    }

    highlighterPromise
      .then((hl) => {
        setHighlighter(hl);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useHighlighter] Failed to create highlighter:", err);
        setError(err);
        setLoading(false);
      });
  }, []);

  return { highlighter, loading, error };
}

export function highlightCode(
  highlighter: Highlighter,
  code: string,
  language: BundledLanguage
): string {
  try {
    return highlighter.codeToHtml(code, {
      lang: language,
      theme: "github-dark",
    });
  } catch {
    // If the language is not loaded, return escaped code
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
