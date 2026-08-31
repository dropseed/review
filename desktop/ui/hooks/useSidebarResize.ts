import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSpurStore } from "../stores";
import {
  SIDEBAR_LIMITS,
  clampSidebarWidth,
  rafThrottle,
  rootFontSize,
  type SidebarPosition,
} from "../utils/resize";

interface UseSidebarResizeOptions {
  /** Which side of the window the panel occupies — one panel per side. */
  sidebarPosition: SidebarPosition;
  /**
   * Bounds for the drag. They default to (and today match) the canonical values
   * in SIDEBAR_LIMITS, which is also what the handle's double-click snaps to.
   */
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /**
   * Width of the box this panel actually sits in, in px, when that is not the
   * window.
   *
   * The window is the right measure for a panel on the window's own edge — the
   * sidebar. It is the wrong one for the files column, which lives inside the
   * code half: the window minus the sidebar minus the terminal. Clamped against
   * the window, a stored width that is a third of the screen can be most of the
   * half it is drawn in, and since the panel's inner box keeps its chosen width
   * so collapsing can slide rather than reflow, the overflow *clips* the
   * contents rather than narrowing them. Omit to measure against the window.
   */
  availablePx?: number;
}

interface UseSidebarResizeReturn {
  /** Width to render, in rem: the chosen width held inside the window's means. */
  sidebarWidth: number;
  isResizing: boolean;
  handleResizeStart: (e: React.MouseEvent) => void;
}

/** Window width, re-read at most once per frame while the window is resized. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = rafThrottle(() => setWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    // Mount-time read as well: the first paint may predate the real window size
    // (and a window moved between displays lands here via `resize`).
    setWidth(window.innerWidth);
    return () => {
      window.removeEventListener("resize", onResize);
      onResize.cancel();
    };
  }, []);
  return width;
}

/**
 * Sidebar resize by mouse drag, sized in rem and persisted.
 *
 * The chosen width is the persisted one; what this returns is that width capped
 * against the current window (see utils/resize.ts). So a width picked on an
 * ultrawide narrows on a laptop and comes back untouched on the ultrawide,
 * rather than being permanently rewritten by whichever display was plugged in.
 */
export function useSidebarResize({
  sidebarPosition,
  initialWidth = SIDEBAR_LIMITS[sidebarPosition].defaultRem,
  minWidth = SIDEBAR_LIMITS[sidebarPosition].minRem,
  maxWidth = SIDEBAR_LIMITS[sidebarPosition].maxRem,
  availablePx,
}: UseSidebarResizeOptions): UseSidebarResizeReturn {
  const widthKey = SIDEBAR_LIMITS[sidebarPosition].key;
  const chosenWidth = useSpurStore((s) => s[widthKey]);
  const setSidebarWidth = useSpurStore((s) => s.setSidebarWidth);

  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const rootFontSizeRef = useRef(16);

  const viewportWidth = useViewportWidth();
  // The root font size follows the code-font preference (`--ui-scale`), so the
  // rem→px conversion the window clamp needs has to be re-read when that
  // changes — there's no resize event for a font-size change.
  const codeFontSize = useSpurStore((s) => s.codeFontSize);
  const [rootFontPx, setRootFontPx] = useState(16);
  useLayoutEffect(() => {
    setRootFontPx(rootFontSize());
  }, [codeFontSize]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    rootFontSizeRef.current = rootFontSize();
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    // One store write (and so one re-render of the panel) per frame, however
    // fast the pointer reports. The panel's contents are heavy enough that the
    // dropped intermediate events were the bulk of the drag's cost.
    const commit = rafThrottle((next: number) =>
      setSidebarWidth(widthKey, next),
    );

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const pixelWidth =
        sidebarPosition === "left" ? e.clientX : window.innerWidth - e.clientX;
      const rem = pixelWidth / rootFontSizeRef.current;
      commit(
        Math.round(Math.max(minWidth, Math.min(maxWidth, rem)) * 100) / 100,
      );
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      // Drop any move that hasn't been committed yet. The handle is also the
      // double-click target, and a frame left in flight here would land *after*
      // the dblclick handler has set the canonical width — writing the width
      // the pointer wobbled to back over the reset the user just asked for.
      commit.cancel();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      commit.cancel();
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, [sidebarPosition, minWidth, maxWidth, widthKey, setSidebarWidth]);

  const sidebarWidth = clampSidebarWidth(chosenWidth ?? initialWidth, {
    minRem: minWidth,
    maxRem: maxWidth,
    // A measured container wins over the window; `availablePx` is 0 until the
    // observer's first callback, which must not be read as "no room at all".
    viewportPx: availablePx && availablePx > 0 ? availablePx : viewportWidth,
    rootFontSizePx: rootFontPx,
  });

  return { sidebarWidth, isResizing, handleResizeStart };
}
