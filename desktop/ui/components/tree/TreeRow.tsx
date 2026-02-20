import type { ReactNode } from "react";

/** Indent calculation matching the sidebar tree: depth * 0.8 + 0.5 rem */
export function treeIndent(depth: number): string {
  return `${depth * 0.8 + 0.5}rem`;
}

/** Outer wrapper for a tree node (content-visibility optimization) */
export function TreeNodeItem({ children }: { children: ReactNode }): ReactNode {
  return <div className="file-node-item select-none">{children}</div>;
}

/** Row container with indent, group hover, and layout */
export function TreeRow({
  depth,
  className = "",
  style,
  children,
  ref,
}: {
  depth: number;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}): ReactNode {
  return (
    <div
      ref={ref}
      className={`group flex w-full items-center gap-1.5 py-0.5 pr-2 transition-colors ${className}`}
      style={{ paddingLeft: treeIndent(depth), ...style }}
    >
      {children}
    </div>
  );
}

/** Inner button for clickable row content */
export function TreeRowButton({
  onClick,
  children,
  ...rest
}: {
  onClick?: () => void;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      className="flex flex-1 items-center gap-1.5 text-left min-w-0"
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Expand/collapse chevron. When visible=false renders an empty spacer. */
export function TreeChevron({
  expanded,
  visible = true,
}: {
  expanded: boolean;
  visible?: boolean;
}): ReactNode {
  if (!visible) {
    return <span className="w-3 flex-shrink-0" />;
  }

  return (
    <svg
      className={`h-3 w-3 flex-shrink-0 text-fg-faint transition-transform ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M10 6l6 6-6 6" />
    </svg>
  );
}

/** Truncated name span for tree nodes */
export function TreeNodeName({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <span className={`min-w-0 flex-1 truncate text-xs ${className}`}>
      {children}
    </span>
  );
}
