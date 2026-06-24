import { useState, useCallback, useEffect, useRef } from "react";
import type { TokenEventBase } from "@pierre/diffs";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
import { useReviewStore } from "../stores";
import { getAllHunksFromState } from "../stores/selectors/hunks";
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
import { getUrlAtClick } from "../utils/getUrlAtClick";
import { isNavigableIdentifier } from "../utils/isNavigableIdentifier";

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
    scrollTarget: { type: "line", filePath, lineNumber },
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

export function useSymbolNavigation(scrollNode: HTMLDivElement | null) {
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
    setState((prev) => {
      if (!prev.popoverOpen && !prev.loading) return prev;
      return { ...prev, popoverOpen: false, loading: false };
    });
  }, []);

  // The symbol popover anchors to the click position; dismiss when the diff
  // scrolls so the popover doesn't float over the wrong line.
  useEffect(() => {
    if (!scrollNode) return;
    const handleScroll = () => closePopover();
    scrollNode.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollNode.removeEventListener("scroll", handleScroll);
  }, [scrollNode, closePopover]);

  const navigateToDefinition = useCallback(
    (def: SymbolDefinition) => {
      if (def.isExternal) {
        // External file: open via read-only external viewer
        useReviewStore.getState().setExternalFile(def.filePath, def.startLine);
      } else {
        navigateToFileAndLine(def.filePath, def.startLine);
      }
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

  const lookUpSymbol = useCallback(
    async (
      word: string,
      position: { x: number; y: number },
      lsp: { line: number; character: number } | null,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const state = useReviewStore.getState();
      const { repoPath, symbolDiffs, comparison } = state;
      if (!repoPath || !comparison) return;
      const hunks = getAllHunksFromState(state);

      setState({
        popoverOpen: true,
        popoverPosition: position,
        symbolName: word,
        definitions: [],
        references: [],
        loading: true,
      });

      try {
        const references = findSymbolReferencesInDiff(word, hunks);

        const api = getApiClient();

        const { selectedFile, externalFilePath } = useReviewStore.getState();
        const currentFile = externalFilePath ?? selectedFile;
        const lspDefs =
          lsp && currentFile
            ? await api
                .lspGotoDefinition(
                  repoPath,
                  currentFile,
                  lsp.line,
                  lsp.character,
                )
                .catch((err: unknown) => {
                  console.error("[lsp] goto_definition failed:", err);
                  return [] as SymbolDefinition[];
                })
            : [];

        if (controller.signal.aborted) return;

        // LSP wins: when a language server resolves the symbol it knows the
        // exact definition, so use its results alone and skip the noisy
        // tree-sitter name matches. The repo-wide tree-sitter scan (+ diff) is
        // the fallback, run only when no LSP server resolved the symbol.
        const fromLsp = lspDefs.length > 0;
        let definitions: EnrichedDefinition[];
        if (fromLsp) {
          definitions = lspDefs.map((d) => ({
            ...d,
            // LSP goto returns locations without a name; carry the clicked
            // identifier so the popover shows something meaningful.
            name: d.name || word,
            changeType: findChangeType({ ...d, name: word }, symbolDiffs),
          }));
        } else {
          const backendDefs = await api.findSymbolDefinitions(
            repoPath,
            word,
            comparison.head,
          );
          if (controller.signal.aborted) return;
          const diffDefs = findDefinitionsFromSymbolDiffs(word, symbolDiffs);
          const seen = new Set(
            backendDefs.map((d) => `${d.filePath}:${d.startLine}`),
          );
          definitions = backendDefs.map((d) => ({
            ...d,
            changeType: findChangeType(d, symbolDiffs),
          }));
          definitions.push(
            ...diffDefs.filter(
              (d) => !seen.has(`${d.filePath}:${d.startLine}`),
            ),
          );
        }

        // Jump straight to an unambiguous definition rather than making the
        // user click through a one-item popover. When LSP resolved it, the
        // result is authoritative so we jump even if the diff has references;
        // for the fuzzier tree-sitter fallback we still surface references.
        if (definitions.length === 1 && (fromLsp || references.length === 0)) {
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

  const onTokenClick = useCallback(
    (props: TokenEventBase, event: MouseEvent) => {
      if (!event.metaKey) return;

      // Cmd+click on a URL opens it; otherwise treat as symbol navigation.
      const url = getUrlAtClick(event);
      if (url) {
        event.preventDefault();
        event.stopPropagation();
        getPlatformServices().opener.openUrl(url);
        return;
      }

      const word = props.tokenText.trim();
      if (!isNavigableIdentifier(word)) return;

      void lookUpSymbol(
        word,
        { x: event.clientX, y: event.clientY },
        { line: props.lineNumber - 1, character: props.lineCharStart + 1 },
      );
    },
    [lookUpSymbol],
  );

  return {
    ...state,
    onTokenClick,
    closePopover,
    navigateToDefinition,
    navigateToReference,
  };
}
