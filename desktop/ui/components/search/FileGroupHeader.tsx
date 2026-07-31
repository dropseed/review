import type { ReactNode } from "react";

export function FileGroupHeader({
  filePath,
  count,
}: {
  filePath: string;
  count: number;
}): ReactNode {
  return (
    <div className="sticky top-0 z-10 bg-surface-panel border-b border-edge/50 px-3 py-1.5 flex items-center gap-2">
      <svg
        aria-hidden="true"
        className="h-3 w-3 text-fg-muted flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="text-xxs font-mono text-fg-muted truncate flex-1 min-w-0">
        {filePath}
      </span>
      <span className="text-xxs text-fg-faint flex-shrink-0">{count}</span>
    </div>
  );
}
