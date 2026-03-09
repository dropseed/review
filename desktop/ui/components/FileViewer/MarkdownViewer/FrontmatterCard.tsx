interface FrontmatterCardProps {
  data: Record<string, unknown>;
}

export function FrontmatterCard({ data }: FrontmatterCardProps) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-edge-default/80 bg-surface-raised/50 overflow-hidden">
      <dl className="grid grid-cols-[auto_1fr] text-sm">
        {entries.map(([key, value], i) => (
          <div
            key={key}
            className={`col-span-2 grid grid-cols-subgrid items-baseline ${
              i < entries.length - 1 ? "border-b border-edge" : ""
            }`}
          >
            <dt className="px-4 py-2 font-mono text-xs text-fg-muted select-none">
              {key}
            </dt>
            <dd className="px-4 py-2 text-fg-secondary">
              <FormatValue value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FormatValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-fg-muted">—</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="font-mono text-xs">{value ? "true" : "false"}</span>
    );
  }

  if (value instanceof Date) {
    return <span>{value.toLocaleDateString()}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {value.map((item, i) => (
          <span
            key={i}
            className="inline-block rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-medium"
          >
            {String(item)}
          </span>
        ))}
      </span>
    );
  }

  if (typeof value === "object") {
    return (
      <code className="font-mono text-xs text-fg-muted">
        {JSON.stringify(value)}
      </code>
    );
  }

  return <span>{String(value)}</span>;
}
