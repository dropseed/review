import { useMemo } from "react";

interface HighlightedTextProps {
  text: string;
  /** Code-unit offsets into `text`, as returned in a `FieldHit`. */
  indices: number[];
  /** Class applied to matched runs. */
  className?: string;
}

interface Segment {
  text: string;
  matched: boolean;
}

/**
 * Split `text` into alternating matched/unmatched runs.
 *
 * Walks by code point rather than code unit so an astral character — an emoji
 * in a command title, say — is never torn in half across two elements, and
 * coalesces adjacent characters into one segment so a long path renders a
 * handful of elements instead of one per character.
 */
function segment(text: string, indices: number[]): Segment[] {
  const set = new Set(indices);
  const segments: Segment[] = [];
  let buffer = "";
  let matched = false;

  for (let i = 0; i < text.length;) {
    const code = text.codePointAt(i)!;
    const width = code > 0xffff ? 2 : 1;
    const char = text.slice(i, i + width);
    // A surrogate pair is highlighted if either half was matched — the
    // matcher indexes code units, so a match can land on either.
    const isMatch = set.has(i) || (width === 2 && set.has(i + 1));

    if (buffer && isMatch !== matched) {
      segments.push({ text: buffer, matched });
      buffer = "";
    }
    matched = isMatch;
    buffer += char;
    i += width;
  }

  if (buffer) segments.push({ text: buffer, matched });
  return segments;
}

/**
 * Render `text` with the characters the fuzzy matcher landed on emphasized.
 */
export function HighlightedText({
  text,
  indices,
  className = "text-status-modified font-medium",
}: HighlightedTextProps) {
  const segments = useMemo(() => segment(text, indices), [text, indices]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.matched ? (
          <span key={i} className={className}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
