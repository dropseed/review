import { useMemo } from "react";
import { DEFAULT_VIRTUAL_FILE_METRICS } from "@pierre/diffs";
import type { VirtualFileMetrics } from "@pierre/diffs";
import { useReviewStore } from "../stores";

/**
 * Single source of truth for code font geometry. The line height injected
 * into the shadow DOM (via fontCSS) and the one fed to the virtualizer's
 * height estimates (via useVirtualFileMetrics) must agree — a mismatch makes
 * the virtualizer's scrollable area systematically wrong and content near
 * the bottom gets cut off.
 */
export function useCodeFont(): { lineHeight: number; fontCSS: string } {
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);
  return useMemo(() => {
    const lineHeight = Math.round(codeFontSize * 1.5);
    return {
      lineHeight,
      fontCSS: `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; --diffs-font-family: ${codeFontFamily}; }`,
    };
  }, [codeFontSize, codeFontFamily]);
}

/** Virtualizer metrics matching the injected line height. */
export function useVirtualFileMetrics(lineHeight: number): VirtualFileMetrics {
  return useMemo(
    () => ({ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight }),
    [lineHeight],
  );
}
