/**
 * Detects URLs under Cmd+click in Shiki-highlighted code.
 *
 * Shiki splits tokens across multiple <span> elements, so a URL like
 * "https://example.com/path" may be 4+ spans. We reconstruct the full
 * line text, find the clicked span's character offset, and check if it
 * falls within a URL.
 */

const URL_RE = /https?:\/\/[^\s"'`<>)\]},;]+/g;

/** Strip trailing punctuation likely from sentence-level context, not the URL itself. */
function cleanUrlTrailing(url: string): string {
  let cleaned = url.replace(/[.,]+$/, "");

  // Strip trailing ')' only if unbalanced (preserves Wikipedia-style URLs).
  let open = 0;
  let close = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "(") open++;
    else if (cleaned[i] === ")") close++;
  }
  while (cleaned.endsWith(")") && close > open) {
    cleaned = cleaned.slice(0, -1);
    close--;
  }

  return cleaned;
}

function findUrlAtOffset(
  lineText: string,
  charStart: number,
  charEnd: number,
): string | null {
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(lineText)) !== null) {
    const urlStart = match.index;
    const urlEnd = urlStart + match[0].length;
    if (charStart < urlEnd && charEnd > urlStart) {
      return cleanUrlTrailing(match[0]);
    }
  }
  return null;
}

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
