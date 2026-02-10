import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useReviewStore } from "../stores";

/**
 * Bidirectional sync between the URL file path and the Zustand store.
 *
 * URL format: /:owner/:repo/review/:comparisonKey/file/path/to/File.tsx
 *
 * - URL → Store: On mount or browser back/forward, reads the file path from
 *   the URL splat and calls navigateToBrowse.
 * - Store → URL: On selectedFile/topLevelView change, updates the URL via
 *   navigate(path, { replace: true }) to keep history clean during j/k nav.
 *
 * Uses isSyncingRef to prevent infinite loops between the two directions.
 */
export function useFileRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const selectedFile = useReviewStore((s) => s.selectedFile);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const flatFileList = useReviewStore((s) => s.flatFileList);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const isSyncingRef = useRef(false);

  // Run a callback while suppressing the other sync direction.
  // Resets the flag on the next microtask to avoid infinite loops.
  function runSync(fn: () => void): void {
    isSyncingRef.current = true;
    fn();
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 0);
  }

  const owner = params.owner;
  const repo = params.repo;
  const comparisonKey = params.comparisonKey;

  // Extract file path from URL splat (everything after /file/)
  const splat = params["*"] || "";
  const urlFilePath = splat.startsWith("file/") ? splat.slice(5) : null;

  // --- URL → Store ---
  // When the URL changes (mount, back/forward), sync into the store.
  useEffect(() => {
    if (isSyncingRef.current) return;

    if (urlFilePath) {
      // URL has a file path — validate against flatFileList
      if (flatFileList.length === 0) {
        // File list not loaded yet — defer (the effect will re-run when flatFileList populates)
        return;
      }
      if (flatFileList.includes(urlFilePath)) {
        runSync(() => navigateToBrowse(urlFilePath));
      }
      // If file not in list, ignore (don't crash, just stay on overview)
    } else {
      // No file in URL — go to browse (empty state with Start Guide option)
      runSync(() => navigateToBrowse());
    }
  }, [urlFilePath, flatFileList, navigateToBrowse]);

  // --- Store → URL ---
  // When selectedFile or topLevelView changes, update the URL.
  useEffect(() => {
    if (isSyncingRef.current) return;
    if (!owner || !repo || !comparisonKey) return;

    const basePath = `/${owner}/${repo}/review/${comparisonKey}`;

    let targetPath: string;
    if (topLevelView === "browse" && selectedFile) {
      targetPath = `${basePath}/file/${selectedFile}`;
    } else {
      targetPath = basePath;
    }

    // Only navigate if the path actually changed
    if (location.pathname !== targetPath) {
      runSync(() => navigate(targetPath, { replace: true }));
    }
  }, [
    selectedFile,
    topLevelView,
    owner,
    repo,
    comparisonKey,
    location.pathname,
    navigate,
  ]);
}
