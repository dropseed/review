import { useCallback, useEffect, useRef } from "react";
import type { TokenEventBase } from "@pierre/diffs";

const HIGHLIGHT_STYLE_ID = "word-highlight-style";
const HIGHLIGHT_CSS = `mark[data-word-highlight] {
  background-color: var(--color-selection);
  border-radius: 2px;
  color: inherit;
}`;

const WORD_RE = /^[a-zA-Z0-9_]{2,}$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlight all occurrences of a double-clicked word inside the diff's
 * shadow DOM. Single-click clears (with a 300ms grace so a follow-up
 * dblclick can land); Escape also clears.
 */
export function useWordHighlight(scrollNode: HTMLDivElement | null) {
  const marksRef = useRef<HTMLElement[]>([]);
  const currentWordRef = useRef<string | null>(null);
  const pendingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getShadowRoot = useCallback((): ShadowRoot | null => {
    return scrollNode?.querySelector("diffs-container")?.shadowRoot ?? null;
  }, [scrollNode]);

  const clearHighlights = useCallback(() => {
    const parents = new Set<Node>();
    // Reverse order avoids normalize() corrupting earlier marks' parent refs.
    for (let i = marksRef.current.length - 1; i >= 0; i--) {
      const mark = marksRef.current[i];
      const parent = mark.parentNode;
      if (!parent) continue;
      const text = document.createTextNode(mark.textContent ?? "");
      parent.replaceChild(text, mark);
      parents.add(parent);
    }
    for (const parent of parents) parent.normalize();
    marksRef.current = [];
    currentWordRef.current = null;
    getShadowRoot()?.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
  }, [getShadowRoot]);

  const highlightWord = useCallback(
    (word: string) => {
      const shadow = getShadowRoot();
      if (!shadow) return;

      clearHighlights();
      currentWordRef.current = word;

      if (!shadow.getElementById(HIGHLIGHT_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = HIGHLIGHT_STYLE_ID;
        style.textContent = HIGHLIGHT_CSS;
        shadow.appendChild(style);
      }

      const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "g");
      const codeEls = shadow.querySelectorAll("code");

      for (const codeEl of codeEls) {
        const walker = document.createTreeWalker(
          codeEl,
          NodeFilter.SHOW_TEXT,
          null,
        );
        const textNodes: Text[] = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          textNodes.push(node);
        }

        for (const textNode of textNodes) {
          const value = textNode.nodeValue;
          if (!value) continue;

          re.lastIndex = 0;
          let match: RegExpExecArray | null;
          let current: Text = textNode;
          let offset = 0;

          while ((match = re.exec(value)) !== null) {
            const matchStart = match.index - offset;
            const matchLen = match[0].length;

            if (matchStart > 0) current = current.splitText(matchStart);

            const after =
              current.nodeValue!.length > matchLen
                ? current.splitText(matchLen)
                : null;

            const mark = document.createElement("mark");
            mark.setAttribute("data-word-highlight", "");
            current.parentNode!.replaceChild(mark, current);
            mark.appendChild(current);
            marksRef.current.push(mark);

            if (after) {
              current = after;
              offset = match.index + matchLen;
            } else {
              break;
            }
          }
        }
      }
    },
    [clearHighlights, getShadowRoot],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!currentWordRef.current) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        return;
      }
      clearHighlights();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (pendingClearRef.current) clearTimeout(pendingClearRef.current);
    };
  }, [clearHighlights]);

  const onTokenClick = useCallback(
    (props: TokenEventBase, event: MouseEvent) => {
      if (event.metaKey) return;

      const word = props.tokenText.trim();

      if (event.detail >= 2) {
        if (pendingClearRef.current) {
          clearTimeout(pendingClearRef.current);
          pendingClearRef.current = null;
        }
        if (!WORD_RE.test(word) || word === currentWordRef.current) return;
        // Defer until after the browser's text selection finishes; otherwise
        // the selection range we mutate underneath gets clobbered.
        setTimeout(() => highlightWord(word), 0);
        return;
      }

      // Single click: queue a clear; a follow-up dblclick will cancel it.
      if (!currentWordRef.current) return;
      if (pendingClearRef.current) clearTimeout(pendingClearRef.current);
      pendingClearRef.current = setTimeout(() => {
        pendingClearRef.current = null;
        clearHighlights();
      }, 300);
    },
    [clearHighlights, highlightWord],
  );

  return { onTokenClick };
}
