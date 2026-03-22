import { useState, useEffect, useCallback, useRef } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { getPositionFromEvent } from "../utils/getUrlAtClick";

interface HoverPosition {
  x: number;
  y: number;
}

interface HoverState {
  hoverContent: string | null;
  hoverPosition: HoverPosition | null;
}

/**
 * Provides LSP hover info when the user hovers over code while holding Meta/Cmd.
 * Debounces 300ms, cancels on element change, Meta release, or scroll.
 */
export function useHoverInfo(scrollNode: HTMLDivElement | null) {
  const [state, setState] = useState<HoverState>({
    hoverContent: null,
    hoverPosition: null,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpanRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const dismissHover = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    lastSpanRef.current = null;
    setState({ hoverContent: null, hoverPosition: null });
  }, []);

  useEffect(() => {
    const node = scrollNode;
    if (!node) return;

    let cmdDown = false;

    const getShadowRoot = () =>
      node.querySelector("diffs-container")?.shadowRoot ?? null;

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

    const handleMouseMove = (e: Event) => {
      if (!cmdDown) return;

      const mouseEvent = e as MouseEvent;
      const target = mouseEvent.composedPath?.()[0];

      // Find the span element
      let span: HTMLElement | null = null;
      if (target instanceof HTMLElement && target.tagName === "SPAN") {
        span = target;
      }

      // If hovering same span, do nothing
      if (span === lastSpanRef.current) return;

      // Cancel any pending request
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortRef.current?.abort();

      // If no span, clear state
      if (!span || !span.textContent?.trim()) {
        lastSpanRef.current = null;
        setState({ hoverContent: null, hoverPosition: null });
        return;
      }

      lastSpanRef.current = span;
      const capturedSpan = span;
      const clientX = mouseEvent.clientX;
      const clientY = mouseEvent.clientY;

      // Capture position info BEFORE the debounce — the browser may recycle
      // the MouseEvent object by the time the timeout fires.
      const { selectedFile, externalFilePath, repoPath } =
        useReviewStore.getState();
      const filePath = externalFilePath ?? selectedFile;
      if (!filePath || !repoPath) return;

      const posInfo = getPositionFromEvent(mouseEvent, filePath, capturedSpan);
      if (!posInfo) return;

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;

        const controller = new AbortController();
        abortRef.current = controller;

        getApiClient()
          .lspHover(repoPath, posInfo.filePath, posInfo.line, posInfo.character)
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
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        cmdDown = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        cmdDown = false;
        dismissHover();
      }
    };

    const handleBlur = () => {
      cmdDown = false;
      dismissHover();
    };

    const handleScroll = () => {
      dismissHover();
    };

    // Attach mousemove to shadow root if available
    const attachMoveListener = () => {
      const shadow = getShadowRoot();
      const moveTarget = shadow ?? node;
      moveTarget.addEventListener("mousemove", handleMouseMove);
      return moveTarget;
    };

    let moveTarget = attachMoveListener();

    const observer = new MutationObserver(() => {
      const shadow = getShadowRoot();
      if (!shadow) return;
      moveTarget.removeEventListener("mousemove", handleMouseMove);
      moveTarget = shadow;
      shadow.addEventListener("mousemove", handleMouseMove);
      observer.disconnect();
    });
    observer.observe(node, { childList: true, subtree: true });

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    node.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortRef.current?.abort();
      observer.disconnect();
      moveTarget.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      node.removeEventListener("scroll", handleScroll);
    };
  }, [scrollNode, dismissHover]);

  return {
    hoverContent: state.hoverContent,
    hoverPosition: state.hoverPosition,
    dismissHover,
  };
}
