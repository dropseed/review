import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSpurStore } from "../stores";
import { activeContentOverlay } from "../stores/slices/navigationSlice";
import { reviewUrl } from "../utils/repo-identity";

/**
 * Bidirectional sync between the URL file path and the Zustand store.
 *
 * URL format: /:owner/:repo/review/:ref/file/path/to/File.tsx
 *
 * - URL → Store: On mount or browser back/forward, reads the file path from
 *   the URL splat and calls navigateToBrowse.
 * - Store → URL: On selectedFile/guideContentMode change, updates the URL via
 *   navigate(path, { replace: true }) to keep history clean during j/k nav.
 *
 * Uses isSyncingRef to prevent infinite loops between the two directions.
 */
export function useFileRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const selectedFile = useSpurStore((s) => s.selectedFile);
  const overlay = useSpurStore(activeContentOverlay);
  const flatFileList = useSpurStore((s) => s.flatFileList);
  const navigateToBrowse = useSpurStore((s) => s.navigateToBrowse);

  const isSyncingRef = useRef(false);

  // Run a callback while suppressing the other sync direction.
  // Resets the flag on the next macrotask to avoid infinite loops.
  function runSync(fn: () => void): void {
    isSyncingRef.current = true;
    fn();
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 0);
  }

  const owner = params.owner;
  const repo = params.repo;
  // Decoded ref for the active review route (react-router decodes params).
  const reviewRef = params.ref;

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

  // Detect whether we're on a browse or review route
  const isBrowseRoute = location.pathname.includes("/browse");

  // --- Store → URL ---
  // When selectedFile or guideContentMode changes, update the URL.
  // Skip URL updates in guide mode to avoid a race condition where the
  // URL change triggers the URL → Store sync which calls navigateToBrowse(),
  // immediately overriding the guide view.
  useEffect(() => {
    if (isSyncingRef.current) return;
    // An overlay is showing something other than the selected file, so the URL
    // must not follow a selection the screen isn't reflecting.
    if (overlay !== null) return;
    if (!owner || !repo) return;
    if (!isBrowseRoute && !reviewRef) return;
    // A file in the URL that the store hasn't adopted *yet* is not a stale URL
    // to correct — it is the load this hook's other half is still waiting on.
    // Both effects run on mount; without this the empty selection wins the
    // race, rewrites the URL to the base path, and the file path is gone
    // before the list it would have been validated against arrives. It shows
    // up as "opening a link to a file lands on the file list", which is every
    // cold start of the installed app and every shared URL.
    if (
      selectedFile === null &&
      urlFilePath !== null &&
      flatFileList.length === 0
    )
      return;

    const basePath = isBrowseRoute
      ? `/${owner}/${repo}/browse`
      : reviewUrl(`${owner}/${repo}`, reviewRef!);

    const targetPath = selectedFile
      ? `${basePath}/file/${selectedFile}`
      : basePath;

    // Only navigate if the path actually changed
    if (location.pathname !== targetPath) {
      const { isProgrammaticNavigation } = useSpurStore.getState();
      runSync(() =>
        navigate(targetPath, { replace: !isProgrammaticNavigation }),
      );
      if (isProgrammaticNavigation) {
        useSpurStore.setState({ canGoBack: true });
      }
    }
  }, [
    selectedFile,
    overlay,
    owner,
    repo,
    reviewRef,
    isBrowseRoute,
    location.pathname,
    navigate,
    urlFilePath,
    flatFileList,
  ]);
}
