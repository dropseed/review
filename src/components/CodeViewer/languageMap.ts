import type { SupportedLanguages } from "@pierre/diffs/react";
import type { ContentType } from "../../types";

// Image extensions
const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "icns",
  "bmp",
]);

// Get content type based on file extension
export function getContentType(filePath: string): ContentType {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  if (ext === "svg") {
    return "svg"; // SVG can be both image and text
  }

  if (imageExtensions.has(ext)) {
    return "image";
  }

  // Check if it's a known text/code file
  if (langMap[ext]) {
    return "text";
  }

  // Default to text for unknown extensions
  return "text";
}

// Map file extensions to pierre/diffs supported languages
const langMap: Record<string, SupportedLanguages> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  dockerfile: "dockerfile",
  toml: "toml",
  ini: "ini",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  gql: "graphql",
};

// Map shebang interpreters to languages
const shebangMap: Record<string, SupportedLanguages> = {
  bash: "bash",
  sh: "bash",
  zsh: "bash",
  python: "python",
  python3: "python",
  node: "javascript",
  ruby: "ruby",
  perl: "perl",
  php: "php",
};

// Map known filenames to languages
const filenameMap: Record<string, SupportedLanguages> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  vagrantfile: "ruby",
  ".editorconfig": "ini",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".bash_profile": "bash",
  ".profile": "bash",
};

// Detect language from shebang line
function detectFromShebang(firstLine: string): SupportedLanguages | undefined {
  if (!firstLine.startsWith("#!")) return undefined;

  // Handle #!/usr/bin/env <lang>
  const envMatch = firstLine.match(/^#!\/usr\/bin\/env\s+(\w+)/);
  if (envMatch) return shebangMap[envMatch[1]];

  // Handle #!/bin/<lang> or #!/usr/bin/<lang>
  const directMatch = firstLine.match(/^#!(?:\/usr)?\/bin\/(\w+)/);
  if (directMatch) return shebangMap[directMatch[1]];

  return undefined;
}

export function getLanguageFromFilename(
  filePath: string,
): SupportedLanguages | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? langMap[ext] : undefined;
}

export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

// Detect language from file path and optionally content
export function detectLanguage(
  filePath: string,
  content?: string,
): SupportedLanguages | undefined {
  // 1. Try extension first (most common case)
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext && langMap[ext]) {
    return langMap[ext];
  }

  // 2. Try filename patterns
  const filename = filePath.split("/").pop()?.toLowerCase();
  if (filename && filenameMap[filename]) {
    return filenameMap[filename];
  }

  // 3. Try shebang detection if content provided
  if (content) {
    const firstLine = content.split("\n")[0];
    const shebangLang = detectFromShebang(firstLine);
    if (shebangLang) return shebangLang;
  }

  return undefined;
}
