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
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);
  const fileToReveal = useReviewStore((s) => s.fileToReveal);
  const clearFileToReveal = useReviewStore((s) => s.clearFileToReveal);
  const directoryToReveal = useReviewStore((s) => s.directoryToReveal);
  const clearDirectoryToReveal = useReviewStore(
    (s) => s.clearDirectoryToReveal,
  );
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

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

  // Auto-switch to Changes tab when guide mode is activated
  const changesViewMode = useReviewStore((s) => s.changesViewMode);
  const prevChangesViewMode = useRef(changesViewMode);

  useEffect(() => {
    const wasGuide = prevChangesViewMode.current === "guide";
    prevChangesViewMode.current = changesViewMode;

    if (changesViewMode === "guide" && !wasGuide) {
      setFilesPanelTab("changes");
    }
  }, [changesViewMode]);

  // Handle external tab switch requests (e.g., from header Git status indicator)
  const requestedFilesPanelTab = useReviewStore(
    (s) => s.requestedFilesPanelTab,
  );
  const clearRequestedFilesPanelTab = useReviewStore(
    (s) => s.clearRequestedFilesPanelTab,
  );
  useEffect(() => {
    if (requestedFilesPanelTab) {
      setFilesPanelTab(requestedFilesPanelTab as FilesPanelTab);
      userHasChosenFilesPanelTab.current = true;
      clearRequestedFilesPanelTab();
    }
  }, [requestedFilesPanelTab, clearRequestedFilesPanelTab]);

  // Auto-switch away from git tab when working tree is no longer included
  const gitStatus = useReviewStore((s) => s.gitStatus);
  const comparison = useReviewStore((s) => s.comparison);

  useEffect(() => {
    if (viewMode !== "git") return;
    const showGitTab =
      gitStatus !== null && comparison.head === gitStatus.currentBranch;
    if (!showGitTab) {
      setFilesPanelTab("changes");
    }
  }, [viewMode, gitStatus, comparison.head]);

  // Auto-switch to/from search tab only on searchActive transitions
  const searchActive = useReviewStore((s) => s.searchActive);
  const tabBeforeSearch = useRef<FilesPanelTab | null>(null);
  const prevSearchActive = useRef(searchActive);

  useEffect(() => {
    const wasActive = prevSearchActive.current;
    prevSearchActive.current = searchActive;

    // Auto-switch to search tab when search first becomes active
    if (searchActive && !wasActive) {
      tabBeforeSearch.current = viewMode;
      setFilesPanelTab("search");
    }
    // Auto-switch back when search is cleared (if still on search tab)
    if (!searchActive && wasActive && viewMode === "search") {
      setFilesPanelTab(tabBeforeSearch.current ?? "changes");
      tabBeforeSearch.current = null;
    }
  }, [searchActive, viewMode]);

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

      const timerId = setTimeout(() => {
        const ref = fileRefs.current.get(targetPath);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
      return () => clearTimeout(timerId);
    },
    [expandedPaths],
  );

  // Reveal file in tree
  useEffect(() => {
    if (!fileToReveal) return;
    const cleanup = expandAndScrollTo(fileToReveal, false);
    clearFileToReveal();
    return cleanup;
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

    const cleanup = expandAndScrollTo(directoryToReveal, true);
    clearDirectoryToReveal();
    return cleanup;
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
      if (guideContentMode !== null) {
        // Auto-switch from guide content to file view when clicking a file in sidebar
        navigateToBrowse(path);
      } else {
        setSelectedFile(path);
      }
    },
    [setSelectedFile, guideContentMode, navigateToBrowse],
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
