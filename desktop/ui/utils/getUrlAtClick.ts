import { findUrlAtOffset } from "./urlInText";

/**
 * Detects URLs under Cmd+click in Shiki-highlighted code.
 *
 * Shiki splits tokens across multiple <span> elements, so a URL like
 * "https://example.com/path" may be 4+ spans. We reconstruct the full
 * line text, find the clicked span's character offset, and check if it
 * falls within a URL. Which URL that is — and where it ends — is
 * `utils/urlInText`, shared with the terminal's own tap-to-open.
 */

function getClickedSpan(event: MouseEvent): HTMLElement | null {
  for (const el of event.composedPath()) {
    if (el instanceof HTMLElement && el.tagName === "SPAN") return el;
  }
  return null;
}

export function getUrlAtClick(event: MouseEvent): string | null {
  const clickedSpan = getClickedSpan(event);
  if (!clickedSpan) return null;

  let lineContainer: HTMLElement | null = clickedSpan.parentElement;
  while (lineContainer) {
    if (
      lineContainer.hasAttribute("data-column-content") ||
      lineContainer.tagName === "CODE"
    ) {
      break;
    }
    lineContainer = lineContainer.parentElement;
  }
  if (!lineContainer) return null;

  let charOffset = 0;
  let spanStart = 0;
  let spanEnd = 0;
  let found = false;

  const walker = document.createTreeWalker(lineContainer, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const len = textNode.length;
    if (textNode.parentElement === clickedSpan) {
      spanStart = charOffset;
      spanEnd = charOffset + len;
      found = true;
      break;
    }
    charOffset += len;
  }

  if (!found) return null;

  const lineText = lineContainer.textContent || "";
  return findUrlAtOffset(lineText, spanStart, spanEnd);
}
