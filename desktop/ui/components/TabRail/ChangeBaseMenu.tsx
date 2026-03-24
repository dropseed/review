import { useState, useRef, useEffect, type ReactNode } from "react";
import type { Comparison } from "../../types";
import { useReviewStore } from "../../stores";
import { Spinner } from "../ui/spinner";
import { getApiClient } from "../../api";

/** Inline branch picker for changing the base ref of a review. */
export function ChangeBaseMenu({
  repoPath,
  comparison,
  onClose,
}: {
  repoPath: string;
  comparison: Comparison;
  onClose: () => void;
}): ReactNode {
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeReviewBase = useReviewStore((s) => s.changeReviewBase);

  useEffect(() => {
    let cancelled = false;
    getApiClient()
      .listBranches(repoPath)
      .then((list) => {
        if (cancelled) return;
        const all = list.local.filter((b) => b !== comparison.head);
        setBranches(all);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, comparison.head]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = filter
    ? branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))
    : branches;

  const handleSelect = async (newBase: string) => {
    if (newBase === comparison.base) {
      onClose();
      return;
    }
    setChanging(true);
    setError(null);
    const result = await changeReviewBase(repoPath, comparison, newBase);
    if (!result) {
      setError(
        `A review for ${newBase}..${comparison.head} may already exist.`,
      );
      setChanging(false);
    } else {
      onClose();
    }
  };

  return (
    <div className="w-56">
      <div className="px-2 pt-1 pb-1">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter branches..."
          className="w-full px-2 py-1 text-xs bg-surface border border-edge rounded
                     text-fg placeholder:text-fg-faint/50 outline-none
                     focus:border-fg/20"
        />
      </div>
      {error && (
        <div className="px-3 py-1 text-[10px] text-status-rejected">
          {error}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center py-3">
            <Spinner className="h-3 w-3 border-[1.5px] border-edge-strong border-t-fg-muted" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-fg-faint">No branches</div>
        ) : (
          filtered.map((b) => (
            <button
              key={b}
              type="button"
              disabled={changing}
              onClick={() => handleSelect(b)}
              className={`w-full px-3 py-1.5 text-left text-xs hover:bg-fg/[0.08]
                         transition-colors disabled:opacity-50 flex items-center gap-1.5
                         ${b === comparison.base ? "text-fg font-medium" : "text-fg-secondary"}`}
            >
              {b === comparison.base && (
                <svg
                  className="h-3 w-3 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span className="truncate">{b}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
