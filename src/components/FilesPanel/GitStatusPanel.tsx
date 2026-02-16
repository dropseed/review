import { useState } from "react";
import { useReviewStore } from "../../stores";
import type { StatusEntry } from "../../types";

const STATUS_COLORS: Record<
  StatusEntry["status"],
  { letter: string; color: string }
> = {
  added: { letter: "A", color: "text-emerald-400" },
  modified: { letter: "M", color: "text-amber-400" },
  deleted: { letter: "D", color: "text-rose-400" },
  renamed: { letter: "R", color: "text-sky-400" },
  copied: { letter: "C", color: "text-sky-400" },
};

function StatusFileRow({
  path,
  status,
  onSelect,
}: {
  path: string;
  status?: StatusEntry["status"];
  onSelect: (path: string) => void;
}) {
  const config = status ? STATUS_COLORS[status] : null;
  const filename = path.split("/").pop() ?? path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      className="flex items-center gap-2 w-full px-3 py-1 text-left text-xs text-stone-300 hover:bg-stone-800/50 transition-colors"
    >
      <span
        className={`w-3 text-center font-mono text-xxs font-medium shrink-0 ${config?.color ?? "text-stone-500"}`}
      >
        {config?.letter ?? "?"}
      </span>
      <span className="truncate">
        {filename}
        {dir && <span className="text-stone-600 ml-1">{dir}</span>}
      </span>
    </button>
  );
}

function CollapsibleSection({
  title,
  count,
  accentColor,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  accentColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-stone-800/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50"
      >
        <svg
          className={`h-3 w-3 text-stone-500 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="flex-1">{title}</span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${accentColor}`}
        >
          {count}
        </span>
      </button>
      {open && <div className="pb-0.5">{children}</div>}
    </div>
  );
}

interface GitStatusPanelProps {
  onSelectFile: (path: string) => void;
}

export function GitStatusPanel({ onSelectFile }: GitStatusPanelProps) {
  const gitStatus = useReviewStore((s) => s.gitStatus);

  if (!gitStatus) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <p className="text-xs text-stone-500">No git status available</p>
      </div>
    );
  }

  const { staged, unstaged, untracked } = gitStatus;
  const hasAny =
    staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <svg
          className="h-8 w-8 text-stone-700 mb-2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-xs text-stone-500">No working tree changes</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {staged.length > 0 && (
        <CollapsibleSection
          title="Staged"
          count={staged.length}
          accentColor="bg-emerald-500/20 text-emerald-300"
        >
          {staged.map((entry) => (
            <StatusFileRow
              key={entry.path}
              path={entry.path}
              status={entry.status}
              onSelect={onSelectFile}
            />
          ))}
        </CollapsibleSection>
      )}

      {unstaged.length > 0 && (
        <CollapsibleSection
          title="Unstaged"
          count={unstaged.length}
          accentColor="bg-amber-500/20 text-amber-300"
        >
          {unstaged.map((entry) => (
            <StatusFileRow
              key={entry.path}
              path={entry.path}
              status={entry.status}
              onSelect={onSelectFile}
            />
          ))}
        </CollapsibleSection>
      )}

      {untracked.length > 0 && (
        <CollapsibleSection
          title="Untracked"
          count={untracked.length}
          accentColor="bg-stone-500/20 text-stone-400"
        >
          {untracked.map((path) => (
            <StatusFileRow key={path} path={path} onSelect={onSelectFile} />
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}
