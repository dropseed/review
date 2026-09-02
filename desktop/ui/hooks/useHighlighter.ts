import { useEffect, useState } from "react";
import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
} from "shiki";

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

export function getLanguageFromFilename(
  filename: string,
): BundledLanguage | null {
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

/**
 * The one main-thread highlighter, created with no grammars.
 *
 * The diff surfaces do their highlighting in pierre's worker pool; this
 * highlighter exists only for the hunk previews inside the move-pair and
 * similar-hunks modals. Handing `createHighlighter` the whole extension map up
 * front — every grammar in `EXTENSION_TO_LANGUAGE`, some sixty of them — meant
 * a session that never opened either modal still paid to fetch, parse and
 * compile sixty TextMate grammars on the main thread at startup, and kept them
 * resident for as long as the app ran. Grammars are loaded per language
 * instead, on the first preview that asks for one.
 */
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [],
    });
    // A rejected creation must not be remembered as settled — a single failure
    // (offline first paint, a chunk 404 after a deploy) would otherwise leave
    // every language unhighlightable for the rest of the session, with each
    // retry re-deriving from the same rejection.
    highlighterPromise.catch(() => {
      highlighterPromise = null;
    });
  }
  return highlighterPromise;
}

/**
 * In-flight and settled grammar loads, so N previews of the same language
 * share one `loadLanguage` rather than racing sixty of them.
 */
const grammarLoads = new Map<BundledLanguage, Promise<Highlighter>>();

function loadGrammar(lang: BundledLanguage): Promise<Highlighter> {
  let load = grammarLoads.get(lang);
  if (!load) {
    load = getHighlighter().then(async (highlighter) => {
      // Idempotent, but the map already makes it so — this is the guard for a
      // grammar the highlighter picked up as another language's dependency.
      if (!highlighter.getLoadedLanguages().includes(lang)) {
        await highlighter.loadLanguage(lang);
      }
      return highlighter;
    });
    grammarLoads.set(lang, load);
    // A failed load must not be remembered as settled, or the language is
    // permanently unhighlightable for the rest of the session.
    load.catch(() => grammarLoads.delete(lang));
  }
  return load;
}

/**
 * What a grammar load settled to, and for which language.
 *
 * The language is carried alongside because the highlighter is a process-wide
 * singleton: the same object is returned before and after a grammar is added to
 * it, so its identity cannot say whether `lang` is loaded yet. Without that,
 * `setHighlighter` after the first resolve is a no-op under `Object.is`, React
 * bails out of the re-render, and a consumer whose language changes is stranded
 * calling `codeToTokens` with a grammar that was never loaded.
 */
type LoadResult =
  | { status: "loaded"; lang: BundledLanguage; highlighter: Highlighter }
  | { status: "failed"; lang: BundledLanguage; error: Error };

/**
 * The highlighter, once it can tokenize `lang`.
 *
 * Returns `null` for a null language (nothing to highlight) and while the
 * grammar is still loading — including the renders after `lang` changes to one
 * that hasn't been fetched yet. Callers render plain text until it arrives.
 */
export function useHighlighter(lang: BundledLanguage | null): {
  highlighter: Highlighter | null;
  loading: boolean;
  error: Error | null;
} {
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    if (lang === null) return;

    // A language change mid-flight must not paint the previous one's result.
    let current = true;
    loadGrammar(lang)
      .then((highlighter) => {
        if (current) setResult({ status: "loaded", lang, highlighter });
      })
      .catch((err: unknown) => {
        console.error("[useHighlighter] Failed to load grammar:", lang, err);
        const error = err instanceof Error ? err : new Error(String(err));
        if (current) setResult({ status: "failed", lang, error });
      });

    return () => {
      current = false;
    };
  }, [lang]);

  // Every field is derived from the settled language rather than stored, so
  // there is no render where a stale `loading` or a previous language's
  // highlighter is visible.
  const settled = result?.lang === lang ? result : null;
  return {
    highlighter: settled?.status === "loaded" ? settled.highlighter : null,
    loading: lang !== null && settled === null,
    error: settled?.status === "failed" ? settled.error : null,
  };
}
