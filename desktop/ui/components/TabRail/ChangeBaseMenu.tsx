import { useState, useRef, useEffect, type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { Spinner } from "../ui/spinner";
import { CheckIcon } from "../ui/icons";
import { getApiClient } from "../../api";

const CHECK = <CheckIcon className="h-3 w-3 shrink-0" />;
const CHECK_SPACER = <span className="h-3 w-3 shrink-0" />;

/** A named base worth one click, above the raw branch list. */
interface Preset {
  /** `null` clears the override and lets the backend ladder derive the base. */
  base: string | null;
  label: string;
  hint: string;
}

/**
 * Inline base picker for a review. The review is identified by its `refName`;
 * selecting a base sets it as the override (identity is unchanged), and the
 * first preset clears it so the base is derived again.
 *
 * Presets come first because the useful bases are named, not arbitrary: the
 * derived default, and — for a branch with a remote — its unpushed work. The
 * filtered branch list below covers everything else.
 */
export function ChangeBaseMenu({
  repoPath,
  refName,
  currentBase,
  onClose,
}: {
  repoPath: string;
  refName: string;
  currentBase?: string;
  onClose: () => void;
}): ReactNode {
  const [branches, setBranches] = useState<string[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setBaseOverride = useReviewStore((s) => s.setBaseOverride);
  const baseOverride = useReviewStore((s) => s.reviewBaseOverride);
  // Already resolved per repo by the sidebar — the menu remounts on every
  // open, so re-fetching it here would spawn a git process each time.
  const defaultBranch = useReviewStore(
    (s) => s.repoMetadata[repoPath]?.defaultBranch,
  );

  useEffect(() => {
    if (!defaultBranch) return;
    let cancelled = false;
    getApiClient()
      .listBranches(repoPath)
      .then((list) => {
        if (cancelled) return;
        setBranches(list.local.filter((b) => b !== refName));

        const isTrunk = refName === defaultBranch;
        const next: Preset[] = [
          isTrunk
            ? { base: null, label: "Uncommitted changes", hint: "working tree" }
            : {
                base: null,
                label: `vs ${defaultBranch}`,
                hint: "whole branch",
              },
        ];
        const remote = `origin/${refName}`;
        if (list.remote.includes(remote)) {
          next.push({ base: remote, label: `vs ${remote}`, hint: "unpushed" });
        }
        setPresets(next);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, refName, defaultBranch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = filter
    ? branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))
    : branches;

  const applyBase = async (newBase: string | null): Promise<void> => {
    // Re-picking the active base is a no-op; presets pass null, which never
    // equals a resolved base, so they always apply.
    if (newBase === currentBase) {
      onClose();
      return;
    }
    setChanging(true);
    setError(null);
    const result = await setBaseOverride(repoPath, refName, newBase);
    if (!result) {
      setError(`Could not set base ${newBase ?? "default"} for ${refName}.`);
      setChanging(false);
    } else {
      onClose();
    }
  };

  const rowClass =
    "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs hover:bg-fg/[0.08] disabled:opacity-50";

  return (
    <div className="w-56">
      {!loading && presets.length > 0 && (
        <div className="border-b border-edge/60 py-1">
          {presets.map((p) => {
            // The derived preset is active only when nothing is pinned;
            // an explicit preset matches the pinned base.
            const active =
              p.base === null ? !baseOverride : baseOverride === p.base;
            return (
              <button
                key={p.label}
                type="button"
                disabled={changing}
                onClick={() => applyBase(p.base)}
                className={`${rowClass} ${active ? "text-fg font-medium" : "text-fg-secondary"}`}
              >
                {active ? CHECK : CHECK_SPACER}
                <span className="min-w-0 flex-1 truncate">{p.label}</span>
                <span className="shrink-0 text-xxs text-fg-faint">
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="px-2 pt-1 pb-1">
        <input
          ref={inputRef}
          type="text"
          name="base-filter"
          aria-label="Filter branches"
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
              onClick={() => applyBase(b)}
              className={`${rowClass} ${b === currentBase ? "text-fg font-medium" : "text-fg-secondary"}`}
            >
              {b === currentBase ? CHECK : CHECK_SPACER}
              <span className="min-w-0 flex-1 truncate">{b}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
