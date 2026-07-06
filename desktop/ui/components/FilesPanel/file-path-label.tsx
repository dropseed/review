import { type ReactNode } from "react";

/** Split a file path into its directory prefix and filename. */
export function splitFilePath(filePath: string): {
  dirPath: string;
  fileName: string;
} {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash < 0) return { dirPath: "", fileName: filePath };
  return {
    dirPath: filePath.substring(0, lastSlash + 1),
    fileName: filePath.substring(lastSlash + 1),
  };
}

/**
 * Renders a file path with the directory dimmed and the filename highlighted.
 * `filenameHoverClass` is the full static Tailwind class for the filename's
 * hover tone (e.g. "group-hover/c:text-fg") — pass a literal so Tailwind can
 * see it; do not build it dynamically.
 */
export function FilePathLabel({
  filePath,
  filenameHoverClass,
}: {
  filePath: string;
  filenameHoverClass: string;
}): ReactNode {
  const { dirPath, fileName } = splitFilePath(filePath);
  return (
    <span className="min-w-0 truncate text-[11px]">
      {dirPath && <span className="text-fg-muted/40">{dirPath}</span>}
      <span className={`text-fg-secondary ${filenameHoverClass}`}>
        {fileName}
      </span>
    </span>
  );
}
