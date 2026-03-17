import { useState, useEffect } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import type { FileSymbol } from "../../types";

/**
 * Fetches tree-sitter symbols for a file. Returns null while loading
 * or if the file has no grammar support. The result is cached in
 * component state and re-fetched when filePath changes.
 */
export function useFileSymbols(filePath: string): FileSymbol[] | null {
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
      .getFileSymbols(repoPath, filePath)
      .then((result) => {
        if (!cancelled) setSymbols(result);
      })
      .catch(() => {
        if (!cancelled) setSymbols(null);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, filePath]);

  return symbols;
}
