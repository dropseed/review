import { useState, useCallback, useRef } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import type {
  SymbolDefinition,
  SymbolChangeType,
  FileSymbolDiff,
  SymbolDiff,
} from "../types";
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

/** A definition enriched with its change status from the diff (if available). */
export interface EnrichedDefinition extends SymbolDefinition {
  changeType?: SymbolChangeType;
}

export interface SymbolNavigationState {
  popoverOpen: boolean;
  popoverPosition: { x: number; y: number };
  symbolName: string;
  definitions: EnrichedDefinition[];
  references: SymbolReferenceInDiff[];
  loading: boolean;
}

/**
 * Navigate to a file and scroll to a specific line.
 * Handles both guide view (navigateToBrowse) and browse view (setSelectedFile).
 * Sets isProgrammaticNavigation so the route sync uses history push (not replace).
 */
function navigateToFileAndLine(filePath: string, lineNumber: number): void {
  const { guideContentMode, navigateToBrowse, setSelectedFile } =
    useReviewStore.getState();

  useReviewStore.setState({ isProgrammaticNavigation: true });

  if (guideContentMode !== null) {
    navigateToBrowse(filePath);
  } else {
    setSelectedFile(filePath);
  }

  useReviewStore.setState({
    scrollToLine: { filePath, lineNumber },
  });

  // Clear the flag after the route sync has a chance to read it
  setTimeout(() => {
    useReviewStore.setState({ isProgrammaticNavigation: false });
  }, 0);
}

/**
 * Find definitions from the already-loaded symbolDiffs in the store.
 * This supplements the backend git-grep results which may fail for
 * files not checked out (e.g. when reviewing a comparison).
 * Includes changeType so the popover can show how the definition changed.
 */
function findDefinitionsFromSymbolDiffs(
  symbolName: string,
  symbolDiffs: FileSymbolDiff[],
): EnrichedDefinition[] {
  const results: EnrichedDefinition[] = [];

  function searchSymbols(symbols: SymbolDiff[], filePath: string): void {
    for (const sym of symbols) {
      if (sym.name === symbolName && sym.kind) {
        // Use newRange for added/modified, oldRange for removed
        const range =
          sym.changeType === "removed" ? sym.oldRange : sym.newRange;
        if (range) {
          results.push({
            filePath,
            name: sym.name,
            kind: sym.kind,
            startLine: range.startLine,
            endLine: range.endLine,
            changeType: sym.changeType,
          });
        }
      }
      if (sym.children.length > 0) {
        searchSymbols(sym.children, filePath);
      }
    }
  }

  for (const fileDiff of symbolDiffs) {
    searchSymbols(fileDiff.symbols, fileDiff.filePath);
  }

  return results;
}

/**
 * Look up a definition's changeType from symbolDiffs.
 * Used to annotate backend git-grep results with diff context.
 */
function findChangeType(
  def: SymbolDefinition,
  symbolDiffs: FileSymbolDiff[],
): SymbolChangeType | undefined {
  const fileDiff = symbolDiffs.find((f) => f.filePath === def.filePath);
  if (!fileDiff) return undefined;

  function search(symbols: SymbolDiff[]): SymbolChangeType | undefined {
    for (const sym of symbols) {
      if (sym.name === def.name && sym.kind === def.kind) {
        return sym.changeType;
      }
      const childResult = search(sym.children);
      if (childResult) return childResult;
    }
    return undefined;
  }

  return search(fileDiff.symbols);
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

      const { repoPath, hunks, symbolDiffs, comparison } =
        useReviewStore.getState();
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
        const backendDefs = await getApiClient().findSymbolDefinitions(
          repoPath,
          word,
          comparison.head,
        );

        if (controller.signal.aborted) return;

        // Supplement backend results with definitions from symbolDiffs,
        // and annotate all definitions with changeType from the diff.
        const diffDefs = findDefinitionsFromSymbolDiffs(word, symbolDiffs);
        const seen = new Set(
          backendDefs.map((d) => `${d.filePath}:${d.startLine}`),
        );
        const definitions: EnrichedDefinition[] = [
          ...backendDefs.map((d) => ({
            ...d,
            changeType: findChangeType(d, symbolDiffs),
          })),
          ...diffDefs.filter((d) => !seen.has(`${d.filePath}:${d.startLine}`)),
        ];

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
