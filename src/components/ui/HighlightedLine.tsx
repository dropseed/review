import type { ReactNode } from "react";

interface HighlightedLineProps {
  content: string;
  query: string;
  column: number;
}

export function HighlightedLine({
  content,
  query,
  column,
}: HighlightedLineProps): ReactNode {
  if (!query) {
    return <span>{content}</span>;
  }

  // Column is 1-indexed, convert to 0-indexed
  const matchStart = column - 1;

  if (matchStart < 0 || matchStart >= content.length) {
    return <span>{content}</span>;
  }

  const clampedEnd = Math.min(matchStart + query.length, content.length);
  const before = content.slice(0, matchStart);
  const match = content.slice(matchStart, clampedEnd);
  const after = content.slice(clampedEnd);

  return (
    <>
      <span>{before}</span>
      <span className="bg-amber-500/30 text-amber-200 font-medium">
        {match}
      </span>
      <span>{after}</span>
    </>
  );
}
