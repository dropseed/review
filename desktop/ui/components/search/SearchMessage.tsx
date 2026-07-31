import type { ReactNode } from "react";

/**
 * Empty / loading / error placeholder for the search view.
 *
 * Left-aligned on the same `px-4` gutter as the result rows and file group
 * headers. It matters more here than it did in the sidebar this came from: the
 * view is as wide as the diff, so a centred message would sit half a screen
 * away from every row it is standing in for.
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
      className={`px-4 py-8 text-xs text-pretty ${
        tone === "error" ? "text-status-rejected" : "text-fg-muted"
      }`}
    >
      {children}
    </div>
  );
}
