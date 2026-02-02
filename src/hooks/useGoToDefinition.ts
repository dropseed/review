import { useState, useCallback } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import type { SymbolDefinition } from "../types";

// Common language keywords to ignore when Cmd+clicking
const KEYWORDS = new Set([
  // JS/TS
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "return",
  "throw",
  "try",
  "catch",
  "finally",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "void",
  "in",
  "of",
  "let",
  "const",
  "var",
  "function",
  "class",
  "extends",
  "super",
  "this",
  "import",
  "export",
  "default",
  "from",
  "as",
  "async",
  "await",
  "yield",
  "true",
  "false",
  "null",
  "undefined",
  // Rust
  "fn",
  "let",
  "mut",
  "pub",
  "mod",
  "use",
  "struct",
  "enum",
  "impl",
  "trait",
  "where",
  "self",
  "Self",
  "crate",
  "match",
  "loop",
  "move",
  "ref",
  "type",
  "dyn",
  "unsafe",
  // Python
  "def",
  "elif",
  "except",
  "lambda",
  "pass",
  "raise",
  "with",
  "nonlocal",
  "global",
  "assert",
  "is",
  "not",
  "and",
  "or",
  "None",
  "True",
  "False",
  // Go
  "func",
  "package",
  "range",
  "select",
  "chan",
  "go",
  "defer",
  "map",
  "interface",
  "fallthrough",
  "goto",
]);

const IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Extract the word under the click from the event's composedPath.
 * Uses composedPath() to cross shadow DOM boundaries (for @pierre/diffs).
 */
function getWordAtClick(event: PointerEvent): string | null {
  const path = event.composedPath();

  // Walk the composed path to find the innermost <span> with text
  for (const el of path) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.tagName !== "SPAN") continue;

    const text = el.textContent?.trim();
    if (text && IDENTIFIER_RE.test(text) && !KEYWORDS.has(text)) {
      return text;
    }
  }

  return null;
}

export interface UseGoToDefinitionResult {
  handleGoToDefinition: (event: PointerEvent) => void;
  definitions: SymbolDefinition[];
  pickerOpen: boolean;
  closePicker: () => void;
  navigateToDefinition: (def: SymbolDefinition) => void;
  loading: boolean;
}

export function useGoToDefinition(): UseGoToDefinitionResult {
  const [definitions, setDefinitions] = useState<SymbolDefinition[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const repoPath = useReviewStore((s) => s.repoPath);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const navigateToDefinition = useCallback(
    (def: SymbolDefinition) => {
      setPickerOpen(false);
      navigateToBrowse(def.filePath);

      // Set scrollToLine to highlight the definition
      useReviewStore.setState({
        scrollToLine: {
          filePath: def.filePath,
          lineNumber: def.startLine,
        },
      });
    },
    [navigateToBrowse],
  );

  const handleGoToDefinition = useCallback(
    async (event: PointerEvent) => {
      if (!repoPath) return;

      const symbolName = getWordAtClick(event);
      if (!symbolName) return;

      setLoading(true);

      try {
        const results = await getApiClient().findSymbolDefinitions(
          repoPath,
          symbolName,
        );

        if (results.length === 0) {
          // No definitions found — no-op
          return;
        }

        if (results.length === 1) {
          navigateToDefinition(results[0]);
        } else {
          setDefinitions(results);
          setPickerOpen(true);
        }
      } catch (err) {
        console.error("[useGoToDefinition] Error:", err);
      } finally {
        setLoading(false);
      }
    },
    [repoPath, navigateToDefinition],
  );

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  return {
    handleGoToDefinition,
    definitions,
    pickerOpen,
    closePicker,
    navigateToDefinition,
    loading,
  };
}
