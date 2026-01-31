import { useEffect, useState, useCallback, useRef } from "react";
import { useReviewStore } from "../../../stores";
import type { ViewMode, ProcessedFileEntry } from "../types";

interface UseFilePanelNavigationOptions {
  sectionedFiles: {
    needsReview: ProcessedFileEntry[];
    reviewed: ProcessedFileEntry[];
  };
}

/**
 * Handles file selection and reveal logic in the FilesPanel.
 * Groups: selectedFile, fileToReveal, directoryToReveal, topLevelView
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

  const [viewMode, setViewMode] = useState<ViewMode>("changes");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const fileRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Helper to check if a directory path exists in the processed tree
  const directoryExistsInTree = useCallback(
    (dirPath: string, entries: ProcessedFileEntry[]): boolean => {
      for (const entry of entries) {
        if (!entry.matchesFilter) continue;
        // Check if this entry's path or compacted paths include the directory
        if (entry.compactedPaths.includes(dirPath)) return true;
        if (entry.path === dirPath) return true;
        if (entry.isDirectory && entry.children) {
          if (directoryExistsInTree(dirPath, entry.children)) return true;
        }
      }
      return false;
    },
    [],
  );

  // Reveal file in tree
  useEffect(() => {
    if (fileToReveal) {
      const parts = fileToReveal.split("/");
      const pathsToExpand = new Set(expandedPaths);
      for (let i = 1; i < parts.length; i++) {
        pathsToExpand.add(parts.slice(0, i).join("/"));
      }
      setExpandedPaths(pathsToExpand);

      setTimeout(() => {
        const ref = fileRefs.current.get(fileToReveal);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      clearFileToReveal();
    }
  }, [fileToReveal, clearFileToReveal, expandedPaths]);

  // Reveal directory in tree (from breadcrumb clicks)
  useEffect(() => {
    if (directoryToReveal) {
      // Check if directory exists in changes sections
      const existsInChanges =
        directoryExistsInTree(directoryToReveal, sectionedFiles.needsReview) ||
        directoryExistsInTree(directoryToReveal, sectionedFiles.reviewed);

      // If not in changes sections, switch to All Files view
      if (!existsInChanges && viewMode !== "all") {
        setViewMode("all");
      }

      // Expand parent paths
      const parts = directoryToReveal.split("/");
      const pathsToExpand = new Set(expandedPaths);
      for (let i = 1; i <= parts.length; i++) {
        pathsToExpand.add(parts.slice(0, i).join("/"));
      }
      setExpandedPaths(pathsToExpand);

      // Scroll to directory after a short delay to allow expansion
      setTimeout(() => {
        const ref = fileRefs.current.get(directoryToReveal);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      clearDirectoryToReveal();
    }
  }, [
    directoryToReveal,
    clearDirectoryToReveal,
    directoryExistsInTree,
    sectionedFiles,
    viewMode,
    expandedPaths,
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
