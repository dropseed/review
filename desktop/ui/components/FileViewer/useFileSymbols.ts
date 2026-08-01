import { useState, useEffect } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import type { FileSymbol } from "../../types";

/**
 * Fetches tree-sitter symbols for a file. Returns null while loading
 * or if the file has no grammar support. The result is cached in
 * component state and re-fetched when any of its inputs change.
 */
export function useFileSymbols(
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
  const repoPath = useReviewStore((s) => s.repoPath);
  const [symbols, setSymbols] = useState<FileSymbol[] | null>(null);

  useEffect(() => {
    if (!repoPath || !filePath) {
      setSymbols(null);
      return;
    }

    let cancelled = false;
    setSymbols(null);

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
  }, [repoPath, filePath, gitRef, content]);

  return symbols;
}
