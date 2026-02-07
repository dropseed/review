import { useEffect, useState, useCallback, useRef } from "react";
import { useReviewStore } from "../../../stores";
import type { FilesPanelTab, ProcessedFileEntry } from "../types";

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
  const [viewMode, setFilesPanelTab] = useState<FilesPanelTab>(
    hunks.length === 0 ? "browse" : "changes",
  );
  const userHasChosenFilesPanelTab = useRef(false);

  const handleSetFilesPanelTab = useCallback((mode: FilesPanelTab) => {
    userHasChosenFilesPanelTab.current = true;
    setFilesPanelTab(mode);
  }, []);

  // When hunks are cleared (e.g. new comparison), allow auto-switching again
  // and default to Browse. When hunks arrive and user hasn't explicitly chosen
  // a tab, switch to "changes".
  useEffect(() => {
    if (hunks.length === 0) {
      userHasChosenFilesPanelTab.current = false;
      setFilesPanelTab("browse");
      return;
    }

    if (viewMode === "browse" && !userHasChosenFilesPanelTab.current) {
      setFilesPanelTab("changes");
    }
  }, [hunks.length, viewMode]);

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

    if (!existsInChanges && viewMode !== "browse") {
      setFilesPanelTab("browse");
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

  const loadDirectoryContents = useReviewStore((s) => s.loadDirectoryContents);
  const loadedGitIgnoredDirs = useReviewStore((s) => s.loadedGitIgnoredDirs);

  const togglePath = useCallback(
    (path: string, isGitignored?: boolean) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          // Load contents of gitignored directories when expanding
          if (isGitignored && !loadedGitIgnoredDirs.has(path)) {
            loadDirectoryContents(path);
          }
        }
        return next;
      });
    },
    [loadDirectoryContents, loadedGitIgnoredDirs],
  );

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
    setFilesPanelTab: handleSetFilesPanelTab,
    expandedPaths,
    togglePath,
    handleSelectFile,
    expandAll,
    collapseAll,
    registerRef,
  };
}
