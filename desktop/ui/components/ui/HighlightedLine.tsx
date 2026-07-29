import { useMemo, type ReactNode } from "react";
import { HighlightedText } from "../../lib/fuzzy";

interface HighlightedLineProps {
  content: string;
  query: string;
  column: number;
}

/**
 * A line of code with the backend's reported match range emphasized.
 *
 * The range comes from the search backend as a (column, length) pair rather
 * than from the fuzzy matcher, but it renders through the same component so
 * a line containing an emoji is not split differently here than in the
 * palette — slicing raw code units tears surrogate pairs in half.
 */
export function HighlightedLine({
  content,
  query,
  column,
}: HighlightedLineProps): ReactNode {
  // Column is 1-indexed, convert to 0-indexed
  const matchStart = column - 1;

  const indices = useMemo(() => {
    if (!query || matchStart < 0 || matchStart >= content.length) return null;
    const end = Math.min(matchStart + query.length, content.length);
    const out: number[] = [];
    for (let i = matchStart; i < end; i++) out.push(i);
    return out;
  }, [content, query, matchStart]);

  if (!indices) return <span>{content}</span>;

  return (
    <HighlightedText
      text={content}
      indices={indices}
      className="bg-status-modified/30 text-status-modified font-medium"
    />
  );
}
