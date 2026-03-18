import { useEffect } from "react";

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
 * Highlights all occurrences of a double-clicked word in the shadow DOM.
 * Entirely imperative — no React state, no re-renders.
 */
export function useWordHighlight(scrollNode: HTMLDivElement | null): void {
  useEffect(() => {
    if (!scrollNode) return;

    const getShadowRoot = () =>
      scrollNode.querySelector("diffs-container")?.shadowRoot ?? null;

    let marks: HTMLElement[] = [];
    let currentWord: string | null = null;
    let pendingClearTimer: ReturnType<typeof setTimeout> | null = null;
    let dblClickTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Extract the word from a dblclick event. Uses composedPath() which
     * reliably crosses shadow DOM boundaries (unlike window.getSelection()).
     */
    function getWordFromEvent(e: MouseEvent): string | null {
      // Try 1: the clicked span's text is often a single token/identifier
      for (const el of e.composedPath()) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.tagName === "SPAN") {
          const text = el.textContent?.trim();
          if (text && WORD_RE.test(text)) return text;
        }
        if (el.tagName === "CODE" || el.tagName === "PRE") break;
      }

      // Try 2: use caretRangeFromPoint to find the word at the click offset
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = range.startContainer.textContent ?? "";
        const pos = range.startOffset;
        const before = text.slice(0, pos).match(/[a-zA-Z0-9_]*$/)?.[0] ?? "";
        const after = text.slice(pos).match(/^[a-zA-Z0-9_]*/)?.[0] ?? "";
        const word = before + after;
        if (word.length >= 2) return word;
      }

      // Try 3: fall back to selection API (works in some WebViews)
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const text = sel.toString().trim();
        if (WORD_RE.test(text)) return text;
      }

      return null;
    }

    function ensureStyle(shadow: ShadowRoot): void {
      if (shadow.getElementById(HIGHLIGHT_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = HIGHLIGHT_CSS;
      shadow.appendChild(style);
    }

    function clearHighlights(): void {
      const parents = new Set<Node>();
      // Iterate in reverse so unwrapping later siblings first avoids
      // normalize() from corrupting earlier marks' parent references.
      for (let i = marks.length - 1; i >= 0; i--) {
        const mark = marks[i];
        const parent = mark.parentNode;
        if (!parent) continue;
        const text = document.createTextNode(mark.textContent ?? "");
        parent.replaceChild(text, mark);
        parents.add(parent);
      }
      for (const parent of parents) {
        parent.normalize();
      }
      marks = [];
      currentWord = null;
      getShadowRoot()?.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
    }

    function highlightWord(shadow: ShadowRoot, word: string): void {
      clearHighlights();
      currentWord = word;
      ensureStyle(shadow);

      const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "g");
      const codeEls = shadow.querySelectorAll("code");

      for (const codeEl of codeEls) {
        const walker = document.createTreeWalker(
          codeEl,
          NodeFilter.SHOW_TEXT,
          null,
        );
        // Collect text nodes first to avoid walker invalidation during mutation
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

            // Split before match
            if (matchStart > 0) {
              current = current.splitText(matchStart);
            }

            // Split after match
            const after =
              current.nodeValue!.length > matchLen
                ? current.splitText(matchLen)
                : null;

            // Wrap match in <mark>
            const mark = document.createElement("mark");
            mark.setAttribute("data-word-highlight", "");
            current.parentNode!.replaceChild(mark, current);
            mark.appendChild(current);
            marks.push(mark);

            if (after) {
              current = after;
              offset = match.index + matchLen;
            } else {
              break;
            }
          }
        }
      }
    }

    const handleDblClick = (e: Event) => {
      const me = e as MouseEvent;
      if (me.metaKey) return;

      // Extract word synchronously — composedPath() is only valid during the event
      const word = getWordFromEvent(me);
      if (!word || word === currentWord) return;

      // Cancel any pending clear
      if (pendingClearTimer) {
        clearTimeout(pendingClearTimer);
        pendingClearTimer = null;
      }

      // Defer DOM manipulation to avoid interfering with the browser's selection
      if (dblClickTimer) clearTimeout(dblClickTimer);
      dblClickTimer = setTimeout(() => {
        dblClickTimer = null;
        const shadow = getShadowRoot();
        if (!shadow) return;
        highlightWord(shadow, word);
      }, 0);
    };

    const handleMouseDown = (e: Event) => {
      const me = e as MouseEvent;
      if (me.detail === 1) {
        // Single click — clear highlights after a short delay
        // (dblclick will cancel this if it fires)
        if (pendingClearTimer) clearTimeout(pendingClearTimer);
        pendingClearTimer = setTimeout(() => {
          clearHighlights();
          pendingClearTimer = null;
        }, 300);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!currentWord) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        return;
      }
      clearHighlights();
    };

    // Attach to shadow root, with MutationObserver fallback
    const shadow = getShadowRoot();
    let target: ShadowRoot | HTMLDivElement = shadow ?? scrollNode;
    target.addEventListener("dblclick", handleDblClick);
    target.addEventListener("mousedown", handleMouseDown);

    const observer = new MutationObserver(() => {
      const sr = getShadowRoot();
      if (!sr) return;
      target.removeEventListener("dblclick", handleDblClick);
      target.removeEventListener("mousedown", handleMouseDown);
      target = sr;
      sr.addEventListener("dblclick", handleDblClick);
      sr.addEventListener("mousedown", handleMouseDown);
      observer.disconnect();
    });
    if (!shadow) {
      observer.observe(scrollNode, { childList: true, subtree: true });
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearHighlights();
      if (pendingClearTimer) clearTimeout(pendingClearTimer);
      if (dblClickTimer) clearTimeout(dblClickTimer);
      observer.disconnect();
      target.removeEventListener("dblclick", handleDblClick);
      target.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [scrollNode]);
}
