import { useState, useRef, useCallback, useEffect } from "react";

interface UseSidebarResizeOptions {
  sidebarPosition: "left" | "right";
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

interface UseSidebarResizeReturn {
  sidebarWidth: number;
  handleResizeStart: (e: React.MouseEvent) => void;
}

/**
 * Handles sidebar resize via mouse drag.
 */
export function useSidebarResize({
  sidebarPosition,
  initialWidth = 19.2, // in rem (288px / 15px base)
  minWidth = 13.33, // 200px in rem
  maxWidth = 40, // 600px in rem
}: UseSidebarResizeOptions): UseSidebarResizeReturn {
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // Calculate width based on sidebar position
      // Get the root font size to convert pixels to rem
      const rootFontSize = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const pixelWidth =
        sidebarPosition === "left" ? e.clientX : window.innerWidth - e.clientX;
      // Convert to rem and clamp
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, pixelWidth / rootFontSize),
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarPosition, minWidth, maxWidth]);

  return { sidebarWidth, handleResizeStart };
}
