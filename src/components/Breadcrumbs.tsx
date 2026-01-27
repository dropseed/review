interface BreadcrumbsProps {
  filePath: string;
  onNavigateToDirectory?: (dirPath: string) => void;
}

export function Breadcrumbs({
  filePath,
  onNavigateToDirectory,
}: BreadcrumbsProps) {
  const parts = filePath.split("/");

  return (
    <nav className="flex items-center text-2xs" aria-label="File path">
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        const path = parts.slice(0, index + 1).join("/");

        return (
          <span key={path} className="flex items-center">
            {index > 0 && <span className="mx-1 text-stone-600">/</span>}
            {isLast ? (
              <span className="font-mono text-stone-200">{part}</span>
            ) : (
              <button
                onClick={() => onNavigateToDirectory?.(path)}
                className="font-mono text-stone-500 hover:text-stone-300 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded"
              >
                {part}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
