interface BreadcrumbsProps {
  filePath: string;
}

export function Breadcrumbs({ filePath }: BreadcrumbsProps) {
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
              <span className="font-mono text-stone-500">{part}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
