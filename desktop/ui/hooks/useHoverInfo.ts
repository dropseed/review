import { useState, useEffect, useCallback, useRef } from "react";
import type { TokenEventBase } from "@pierre/diffs";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { isNavigableIdentifier } from "../utils/isNavigableIdentifier";

interface HoverPosition {
  x: number;
  y: number;
}

interface HoverState {
  hoverContent: string | null;
  hoverPosition: HoverPosition | null;
}

const EMPTY_STATE: HoverState = { hoverContent: null, hoverPosition: null };

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
 * Hover affordance for symbol navigation: underlines the identifier under the
 * cursor (the visual cue that Cmd+click will jump to its definition) and, when
 * a language server is available, shows its hover info in a tooltip. The
 * underline appears on plain hover — no modifier required — so the clickable
 * cue is always discoverable; Cmd is reserved for activating the jump.
 *
 * Returns the enter/leave handlers to wire into @pierre/diffs
 * `options.onTokenEnter` / `options.onTokenLeave`. The LSP request is debounced
 * 300ms and cancelled on token change, blur, scroll, or leaving the code area.
 */
export function useHoverInfo(scrollNode: HTMLDivElement | null) {
  const [state, setState] = useState<HoverState>(EMPTY_STATE);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const underlinedRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearUnderlined = useCallback(() => {
    if (underlinedRef.current) {
      clearUnderline(underlinedRef.current);
      underlinedRef.current = null;
    }
  }, []);

  const cancelPending = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
  }, []);

  // Clear the tooltip without touching the underline. Used when moving onto a
  // new token so a stale tooltip doesn't linger over the wrong identifier.
  const clearTooltip = useCallback(() => {
    cancelPending();
    setState((prev) => (prev.hoverContent === null ? prev : EMPTY_STATE));
  }, [cancelPending]);

  const dismissHover = useCallback(() => {
    clearTooltip();
    clearUnderlined();
  }, [clearTooltip, clearUnderlined]);

  useEffect(() => {
    const handleBlur = () => dismissHover();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [dismissHover]);

  // Dismiss on scroll (the tooltip is anchored to a fixed point) and when the
  // pointer leaves the code surface entirely. pierre's onTokenLeave fires
  // between adjacent tokens too, so it can't be trusted to mean "left the code".
  useEffect(() => {
    if (!scrollNode) return;
    const handleScroll = () => dismissHover();
    const handlePointerLeave = () => dismissHover();
    scrollNode.addEventListener("scroll", handleScroll, { passive: true });
    scrollNode.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      scrollNode.removeEventListener("scroll", handleScroll);
      scrollNode.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [scrollNode, dismissHover]);

  const onTokenEnter = useCallback(
    (props: TokenEventBase) => {
      const { tokenText, lineNumber, lineCharStart, tokenElement } = props;
      const word = tokenText.trim();

      // Only identifiers that Cmd+click can actually navigate get the
      // affordance — punctuation, keywords, strings and comments stay plain.
      if (!isNavigableIdentifier(word)) {
        clearUnderlined();
        clearTooltip();
        return;
      }

      if (tokenElement === underlinedRef.current) return;

      // Move the underline to the freshly entered token.
      if (underlinedRef.current) clearUnderline(underlinedRef.current);
      applyUnderline(tokenElement);
      underlinedRef.current = tokenElement;

      // Drop any tooltip/fetch for the previous token before scheduling a new one.
      clearTooltip();

      const { selectedFile, externalFilePath, repoPath } =
        useReviewStore.getState();
      const filePath = externalFilePath ?? selectedFile;
      if (!filePath || !repoPath) return;

      const lspLine = lineNumber - 1;
      if (lspLine < 0) return;
      // Pointing one column into the token rather than at its leading edge —
      // some servers return no hover info at a token boundary.
      const lspChar = lineCharStart + 1;

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const controller = new AbortController();
        abortRef.current = controller;

        // Read layout lazily — only when the user actually pauses on the
        // token, not on every hover that crosses it.
        const rect = tokenElement.getBoundingClientRect();
        const clientX = rect.left;
        const clientY = rect.bottom;

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
              setState((prev) =>
                prev.hoverContent === null ? prev : EMPTY_STATE,
              );
            }
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            console.error("[useHoverInfo] lspHover failed:", err);
          });
      }, 300);
    },
    [clearUnderlined, clearTooltip],
  );

  const onTokenLeave = useCallback(
    (props: TokenEventBase) => {
      if (props.tokenElement === underlinedRef.current) {
        clearUnderlined();
      }
      // Don't dismiss the tooltip here — pierre fires onTokenLeave between
      // adjacent tokens too. Dismissal is driven by scroll, blur, leaving the
      // code surface, or pointerdown outside the tooltip (HoverTooltip handles
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
