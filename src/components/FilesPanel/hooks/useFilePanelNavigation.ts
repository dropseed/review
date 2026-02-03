import { useEffect, useState, useCallback, useRef } from "react";
import { useReviewStore } from "../../../stores";
import type { ViewMode, ProcessedFileEntry } from "../types";

interface UseFilePanelNavigationOptions {
  sectionedFiles: {
    needsReview: ProcessedFileEntry[];
    reviewed: ProcessedFileEntry[];
  };
}

function directoryExistsInTree(
  dirPath: string,
  entries: ProcessedFileEntry[],
): boolean {
  for (const entry of entries) {
    if (!entry.matchesFilter) continue;
    if (entry.compactedPaths.includes(dirPath)) return true;
    if (entry.path === dirPath) return true;
    if (entry.isDirectory && entry.children) {
      if (directoryExistsInTree(dirPath, entry.children)) return true;
    }
  }
  return false;
}

/**
 * Handles file selection and reveal logic in the FilesPanel.
 */
export function useFilePanelNavigation({
  sectionedFiles,
}: UseFilePanelNavigationOptions) {
  const {
    selectedFile,
    setSelectedFile,
    fileToReveal,
    clearFileToReveal,
    directoryToReveal,
    clearDirectoryToReveal,
    topLevelView,
    navigateToBrowse,
  } = useReviewStore();

  const hunks = useReviewStore((s) => s.hunks);
  const [viewMode, setViewMode] = useState<ViewMode>(
    hunks.length === 0 ? "all" : "changes",
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const fileRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const expandAndScrollTo = useCallback(
    (targetPath: string, includeTarget: boolean) => {
      const parts = targetPath.split("/");
      const pathsToExpand = new Set(expandedPaths);
      const end = includeTarget ? parts.length : parts.length - 1;
      for (let i = 1; i <= end; i++) {
        pathsToExpand.add(parts.slice(0, i).join("/"));
      }
      setExpandedPaths(pathsToExpand);

      setTimeout(() => {
        const ref = fileRefs.current.get(targetPath);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    },
    [expandedPaths],
  );

  // Reveal file in tree
  useEffect(() => {
    if (!fileToReveal) return;
    expandAndScrollTo(fileToReveal, false);
    clearFileToReveal();
  }, [fileToReveal, clearFileToReveal, expandAndScrollTo]);

  // Reveal directory in tree (from breadcrumb clicks)
  useEffect(() => {
    if (!directoryToReveal) return;

    const existsInChanges =
      directoryExistsInTree(directoryToReveal, sectionedFiles.needsReview) ||
      directoryExistsInTree(directoryToReveal, sectionedFiles.reviewed);

    if (!existsInChanges && viewMode !== "all") {
      setViewMode("all");
    }

    expandAndScrollTo(directoryToReveal, true);
    clearDirectoryToReveal();
  }, [
    directoryToReveal,
    clearDirectoryToReveal,
    sectionedFiles,
    viewMode,
    expandAndScrollTo,
  ]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectFile = useCallback(
    (path: string) => {
      if (topLevelView === "overview") {
        // Auto-switch from overview to browse when clicking a file in sidebar
        navigateToBrowse(path);
      } else {
        setSelectedFile(path);
      }
    },
    [setSelectedFile, topLevelView, navigateToBrowse],
  );

  const expandAll = useCallback((allDirPaths: Set<string>) => {
    setExpandedPaths(new Set(allDirPaths));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const registerRef = useCallback(
    (path: string, el: HTMLButtonElement | null) => {
      if (el) {
        fileRefs.current.set(path, el);
      } else {
        fileRefs.current.delete(path);
      }
    },
    [],
  );

  return {
    selectedFile,
    viewMode,
    setViewMode,
    expandedPaths,
    togglePath,
    handleSelectFile,
    expandAll,
    collapseAll,
    registerRef,
  };
}
