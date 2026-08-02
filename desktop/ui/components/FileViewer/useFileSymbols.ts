import { useState, useEffect, useRef } from "react";
import { getApiClient } from "../../api";
import type { FileSymbol } from "../../types";

/**
 * Fetches tree-sitter symbols for a file. Returns null while loading
 * or if the file has no grammar support.
 */
export function useFileSymbols(
  /**
   * Root to resolve the file against. Must be the same root the caller reads
   * the *content* from — for a materialized review that is the worktree, not
   * the main checkout, or shape mode folds line ranges from a different copy
   * of the file.
   */
  repoPath: string | null,
  filePath: string,
  /** Revision to read the file at. Omit to read the working copy on disk. */
  gitRef?: string,
  /**
   * The text the caller is rendering. Purely an invalidation key — symbols are
   * extracted server-side, but line numbers only mean something against the
   * content on screen, so new content has to mean new symbols.
   */
  content?: string,
): FileSymbol[] | null {
  const [symbols, setSymbols] = useState<FileSymbol[] | null>(null);
  const identity = `${repoPath ?? ""}\0${filePath}\0${gitRef ?? ""}`;
  const lastIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!repoPath || !filePath) {
      lastIdentity.current = null;
      setSymbols(null);
      return;
    }

    // A different file or revision invalidates immediately — its symbols
    // would fold the wrong document. The same file with *new text* does not:
    // the stale symbols stay up while the refetch runs, so the folds (and
    // which of them the user has opened) survive a save instead of the whole
    // view unfolding and re-collapsing. Line numbers can be briefly off in
    // exchange.
    if (lastIdentity.current !== identity) {
      lastIdentity.current = identity;
      setSymbols(null);
    }

    let cancelled = false;
    getApiClient()
      .getFileSymbols(repoPath, filePath, gitRef)
      .then((result) => {
        if (!cancelled) setSymbols(result);
      })
      .catch(() => {
        if (!cancelled) setSymbols(null);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, filePath, gitRef, content, identity]);

  return symbols;
}
