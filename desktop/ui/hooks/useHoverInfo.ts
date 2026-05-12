import { useState, useEffect, useCallback, useRef } from "react";
import type { TokenEventBase } from "@pierre/diffs";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";

interface HoverPosition {
  x: number;
  y: number;
}

interface HoverState {
  hoverContent: string | null;
  hoverPosition: HoverPosition | null;
}

function parseHoverContents(contents: unknown): string | null {
  if (!contents) return null;

  // MarkedString: { kind: "markdown" | "plaintext", value: string }
  if (
    typeof contents === "object" &&
    contents !== null &&
    "value" in contents
  ) {
    return (contents as { value: string }).value || null;
  }

  // Plain string
  if (typeof contents === "string") {
    return contents || null;
  }

  // Array of MarkedStrings or strings
  if (Array.isArray(contents)) {
    const parts = contents
      .map((c) => {
        if (typeof c === "string") return c;
        if (typeof c === "object" && c !== null && "value" in c)
          return (c as { value: string }).value;
        return null;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join("\n\n") : null;
  }

  return null;
}

function applyUnderline(el: HTMLElement): void {
  el.style.textDecoration = "underline";
  el.style.cursor = "pointer";
}

function clearUnderline(el: HTMLElement): void {
  el.style.textDecoration = "";
  el.style.cursor = "";
}

/**
 * LSP hover info plus the visual "Cmd-hover" affordance (underline + pointer
 * cursor) on the hovered token. Returns the enter/leave handlers to wire into
 * @pierre/diffs `options.onTokenEnter` / `options.onTokenLeave`. Debounces the
 * LSP request 300ms; cancels on token change, Meta release, blur, or scroll.
 */
export function useHoverInfo(scrollNode: HTMLDivElement | null) {
  const [state, setState] = useState<HoverState>({
    hoverContent: null,
    hoverPosition: null,
  });

  const cmdDownRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const underlinedRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearUnderlined = useCallback(() => {
    if (underlinedRef.current) {
      clearUnderline(underlinedRef.current);
      underlinedRef.current = null;
    }
  }, []);

  const dismissHover = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    clearUnderlined();
    setState({ hoverContent: null, hoverPosition: null });
  }, [clearUnderlined]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") cmdDownRef.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        cmdDownRef.current = false;
        dismissHover();
      }
    };
    const handleBlur = () => {
      cmdDownRef.current = false;
      dismissHover();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [dismissHover]);

  useEffect(() => {
    if (!scrollNode) return;
    const handleScroll = () => dismissHover();
    scrollNode.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollNode.removeEventListener("scroll", handleScroll);
  }, [scrollNode, dismissHover]);

  const onTokenEnter = useCallback((props: TokenEventBase) => {
    if (!cmdDownRef.current) return;
    const { tokenText, lineNumber, lineCharStart, tokenElement } = props;
    if (!tokenText.trim()) return;
    if (tokenElement === underlinedRef.current) return;

    if (underlinedRef.current) clearUnderline(underlinedRef.current);
    applyUnderline(tokenElement);
    underlinedRef.current = tokenElement;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();

    const { selectedFile, externalFilePath, repoPath } =
      useReviewStore.getState();
    const filePath = externalFilePath ?? selectedFile;
    if (!filePath || !repoPath) return;

    const lspLine = lineNumber - 1;
    if (lspLine < 0) return;
    // Pointing one column into the token rather than at its leading edge —
    // some servers return no hover info at a token boundary.
    const lspChar = lineCharStart + 1;

    const rect = tokenElement.getBoundingClientRect();
    const clientX = rect.left;
    const clientY = rect.bottom;

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;

      getApiClient()
        .lspHover(repoPath, filePath, lspLine, lspChar)
        .then((result) => {
          if (controller.signal.aborted) return;
          const hover = result as { contents?: unknown } | null;
          const content = hover ? parseHoverContents(hover.contents) : null;
          if (content) {
            setState({
              hoverContent: content,
              hoverPosition: { x: clientX, y: clientY },
            });
          } else {
            setState({ hoverContent: null, hoverPosition: null });
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error("[useHoverInfo] lspHover failed:", err);
        });
    }, 300);
  }, []);

  const onTokenLeave = useCallback(
    (props: TokenEventBase) => {
      if (props.tokenElement === underlinedRef.current) {
        clearUnderlined();
      }
      // Don't dismiss the tooltip here — pierre fires onTokenLeave between
      // adjacent tokens too. Dismissal is driven by Meta release, blur,
      // scroll, or pointerdown outside the tooltip (HoverTooltip handles
      // the last).
    },
    [clearUnderlined],
  );

  return {
    hoverContent: state.hoverContent,
    hoverPosition: state.hoverPosition,
    dismissHover,
    onTokenEnter,
    onTokenLeave,
  };
}
