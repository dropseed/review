import { useEffect } from "react";
import { useReviewStore } from "../stores";

/**
 * Mouse back/forward button support for file navigation.
 *
 * Records each visited file into a linear history stack and maps the mouse's
 * back (button 3) and forward (button 4) buttons to stepping through it — the
 * common "jump back to the previous file" gesture. Other navigation (hunks,
 * reviews, overlays) is intentionally out of scope.
 */
export function useMouseNavigation() {
  const selectedFile = useReviewStore((s) => s.selectedFile);

  // Record every file the user lands on. recordFileVisit dedupes the current
  // entry, so stepping through history doesn't re-push what we just visited.
  useEffect(() => {
    if (selectedFile) {
      useReviewStore.getState().recordFileVisit(selectedFile);
    }
  }, [selectedFile]);

  // Map mouse button 3 (back) / 4 (forward) to the file history. preventDefault
  // on both press and release blocks the browser's own history navigation (web
  // mode) so only our file-history nav fires; the jump happens on release.
  useEffect(() => {
    const isNavButton = (button: number) => button === 3 || button === 4;

    const suppress = (event: MouseEvent) => {
      if (isNavButton(event.button)) event.preventDefault();
    };

    const handleUp = (event: MouseEvent) => {
      if (!isNavButton(event.button)) return;
      event.preventDefault();
      // Modals (Settings, Classifications, Finder, etc.) don't stop-propagate
      // to these window listeners, so without this a side-button click while
      // one is open would silently change the file underneath it. Scoped to
      // `aria-modal` + open state so it doesn't also match a lightweight,
      // non-modal Popover (which shares Radix's `role="dialog"`) or a dialog
      // still finishing its close animation.
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"][data-state="open"]',
        )
      )
        return;
      useReviewStore
        .getState()
        .navigateFileHistory(event.button === 3 ? -1 : 1);
    };

    window.addEventListener("mousedown", suppress);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousedown", suppress);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);
}
