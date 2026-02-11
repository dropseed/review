import { useState, useCallback, useRef } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import type { SymbolDefinition } from "../types";
import {
  findSymbolReferencesInDiff,
  type SymbolReferenceInDiff,
} from "../utils/findSymbolReferencesInDiff";

// Language keywords to filter out (combined across JS/TS, Rust, Python, Go)
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
  "from",
  "default",
  "as",
  "async",
  "await",
  "yield",
  "true",
  "false",
  "null",
  "undefined",
  "with",
  "debugger",
  "enum",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "type",
  // Rust
  "fn",
  "mut",
  "ref",
  "pub",
  "use",
  "mod",
  "crate",
  "self",
  "Self",
  "struct",
  "trait",
  "impl",
  "where",
  "match",
  "loop",
  "move",
  "unsafe",
  "extern",
  "dyn",
  "macro",
  // Python
  "def",
  "and",
  "or",
  "not",
  "is",
  "lambda",
  "pass",
  "raise",
  "global",
  "nonlocal",
  "assert",
  "elif",
  "except",
  "None",
  "True",
  "False",
  // Go
  "func",
  "map",
  "chan",
  "go",
  "defer",
  "select",
  "range",
  "fallthrough",
  "goto",
]);

export interface SymbolNavigationState {
  popoverOpen: boolean;
  popoverPosition: { x: number; y: number };
  symbolName: string;
  definitions: SymbolDefinition[];
  references: SymbolReferenceInDiff[];
  loading: boolean;
}

/**
 * Navigate to a file and scroll to a specific line.
 * Handles both guide view (navigateToBrowse) and browse view (setSelectedFile).
 */
function navigateToFileAndLine(filePath: string, lineNumber: number): void {
  const { topLevelView, navigateToBrowse, setSelectedFile } =
    useReviewStore.getState();

  if (topLevelView === "guide") {
    navigateToBrowse(filePath);
  } else {
    setSelectedFile(filePath);
  }

  useReviewStore.setState({
    scrollToLine: { filePath, lineNumber },
  });
}

export function useSymbolNavigation() {
  const [state, setState] = useState<SymbolNavigationState>({
    popoverOpen: false,
    popoverPosition: { x: 0, y: 0 },
    symbolName: "",
    definitions: [],
    references: [],
    loading: false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const closePopover = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, popoverOpen: false, loading: false }));
  }, []);

  const navigateToDefinition = useCallback(
    (def: SymbolDefinition) => {
      navigateToFileAndLine(def.filePath, def.startLine);
      closePopover();
    },
    [closePopover],
  );

  const navigateToReference = useCallback(
    (ref: SymbolReferenceInDiff) => {
      navigateToFileAndLine(ref.filePath, ref.lineNumber);
      closePopover();
    },
    [closePopover],
  );

  const handleSymbolClick = useCallback(
    async (event: MouseEvent) => {
      const word = getWordAtClick(event);
      if (!word) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const { repoPath, hunks } = useReviewStore.getState();
      if (!repoPath) return;

      setState({
        popoverOpen: true,
        popoverPosition: { x: event.clientX, y: event.clientY },
        symbolName: word,
        definitions: [],
        references: [],
        loading: true,
      });

      try {
        const references = findSymbolReferencesInDiff(word, hunks);
        const definitions = await getApiClient().findSymbolDefinitions(
          repoPath,
          word,
        );

        if (controller.signal.aborted) return;

        // If exactly one definition and no references, navigate directly
        if (definitions.length === 1 && references.length === 0) {
          navigateToDefinition(definitions[0]);
          return;
        }

        setState((prev) => ({
          ...prev,
          definitions,
          references,
          loading: false,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[useSymbolNavigation] Error:", err);
        setState((prev) => ({ ...prev, loading: false }));
      }
    },
    [navigateToDefinition],
  );

  return {
    ...state,
    handleSymbolClick,
    closePopover,
    navigateToDefinition,
    navigateToReference,
  };
}

/**
 * Extract the identifier word at the click position.
 * Walks the composed path to find a span element, then checks if
 * the text content is a valid, non-keyword identifier.
 */
function getWordAtClick(event: MouseEvent): string | null {
  const path = event.composedPath();
  let targetSpan: HTMLElement | null = null;

  for (const el of path) {
    if (el instanceof HTMLElement && el.tagName === "SPAN") {
      targetSpan = el;
      break;
    }
  }

  if (!targetSpan) return null;

  const text = targetSpan.textContent?.trim();
  if (!text) return null;

  // Must be a valid identifier: letter/underscore start, alphanumeric/underscore body
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) return null;

  // Filter short identifiers and keywords
  if (text.length < 3) return null;
  if (KEYWORDS.has(text)) return null;

  return text;
}
