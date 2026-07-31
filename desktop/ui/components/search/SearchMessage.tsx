import type { ReactNode } from "react";

/**
 * Empty / loading / error placeholder for the search panels.
 *
 * Left-aligned on the same `px-3` gutter as the result rows and file group
 * headers: the sidebar is user-resizable, and a centred message drifts to the
 * horizontal middle of a wide pane while every other row stays pinned left.
 */
export function SearchMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}): ReactNode {
  return (
    <div
      className={`px-3 py-8 text-xs text-pretty ${
        tone === "error" ? "text-status-rejected" : "text-fg-muted"
      }`}
    >
      {children}
    </div>
  );
}
