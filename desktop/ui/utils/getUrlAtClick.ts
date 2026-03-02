/**
 * Detects URLs under Cmd+click in Shiki-highlighted code.
 *
 * Shiki splits tokens across multiple <span> elements, so a URL like
 * "https://example.com/path" may be 4+ spans. We reconstruct the full
 * line text, find the clicked span's character offset, and check if it
 * falls within a URL.
 */

const URL_RE = /https?:\/\/[^\s"'`<>)\]},;]+/g;

/**
 * Strip trailing punctuation that's likely sentence-level, not part of the URL.
 * Preserves balanced parentheses (e.g. Wikipedia URLs).
 */
export function cleanUrlTrailing(url: string): string {
  // Strip trailing dots and commas
  let cleaned = url.replace(/[.,]+$/, "");

  // Strip trailing ')' only if unbalanced
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

/**
 * Find a URL in `lineText` that overlaps the character range [charStart, charEnd).
 * Returns the cleaned URL or null.
 */
export function findUrlAtOffset(
  lineText: string,
  charStart: number,
  charEnd: number,
): string | null {
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(lineText)) !== null) {
    const urlStart = match.index;
    const urlEnd = urlStart + match[0].length;
    // Check overlap: clicked span range intersects URL range
    if (charStart < urlEnd && charEnd > urlStart) {
      return cleanUrlTrailing(match[0]);
    }
  }
  return null;
}

/**
 * Walk composedPath to find the first <span> element (works across shadow DOM).
 * Shared by URL detection and symbol navigation.
 */
export function getClickedSpan(event: MouseEvent): HTMLElement | null {
  for (const el of event.composedPath()) {
    if (el instanceof HTMLElement && el.tagName === "SPAN") return el;
  }
  return null;
}

/**
 * Given a click event inside Shiki-highlighted code, return the URL
 * at the click position, or null if none.
 */
export function getUrlAtClick(event: MouseEvent): string | null {
  const clickedSpan = getClickedSpan(event);
  if (!clickedSpan) return null;

  // Find the line container — either [data-column-content] or <code>
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

  // Reconstruct full line text up to and including the clicked span's offset
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
