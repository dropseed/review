import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { getApiClient } from "../../api";
import { rankCandidates } from "../../lib/fuzzy";
import type { RepoChoice } from "./repo-choices";
import { createWorktreeIn } from "./worktree-actions";

/** How many branch suggestions a name is ever picked out of. */
const MAX_SUGGESTIONS = 6;

/**
 * Making a checkout: a repo, and the branch it should hold.
 *
 * One field, because that is the whole decision — where the directory goes is
 * the app's business (the managed root, same as a materialized review), and
 * whether the branch is new is git's answer, not a mode the person has to pick
 * first. A name git knows is checked out; a name it doesn't is created at the
 * repo's HEAD; a name that already has a worktree opens that one.
 *
 * It replaces the picker's body rather than opening a second layer: the picker
 * lives inside a popover, and a dialog over a popover is two dismiss gestures
 * stacked on one Escape.
 */
export function NewWorktreeForm({
  repo,
  onCancel,
  onCreated,
}: {
  repo: RepoChoice;
  onCancel: () => void;
  onCreated: (choice: RepoChoice) => void;
}): ReactNode {
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getApiClient()
      .listBranches(repo.path)
      .then((list) => {
        if (live) setBranches(list.local);
      })
      .catch((err: unknown) => {
        // Suggestions are a convenience; the field takes any name typed into it.
        console.warn("[worktrees] Failed to list branches:", err);
      });
    return () => {
      live = false;
    };
  }, [repo.path]);

  const suggestions = useMemo(
    () => rankCandidates(branch, branches, (name) => name, MAX_SUGGESTIONS),
    [branches, branch],
  );

  async function create(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      onCreated(await createWorktreeIn(repo, trimmed));
    } catch (err) {
      setError(String(err));
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = highlight + (event.key === "ArrowDown" ? 1 : -1);
      if (next >= -1 && next < suggestions.length) setHighlight(next);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // The typed name wins unless a suggestion is highlighted: this field's
      // whole point is that a branch nobody has made yet is a valid answer.
      void create(suggestions[highlight] ?? branch);
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-2 px-0.5 pb-2">
        <span className="text-sm text-fg-secondary">New worktree in</span>
        <span className="min-w-0 truncate text-sm text-fg-muted">
          {repo.name}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto shrink-0 text-xs text-fg-faint hover:text-fg-secondary"
        >
          Cancel
        </button>
      </div>

      <input
        ref={inputRef}
        autoFocus
        value={branch}
        disabled={pending}
        onChange={(e) => {
          setBranch(e.target.value);
          setHighlight(-1);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        aria-label="Branch for the new worktree"
        placeholder="Branch name…"
        spellCheck={false}
        className="w-full shrink-0 rounded-md bg-fg/[0.06] px-3 py-1.5 text-sm
                   text-fg-secondary outline-none placeholder:text-fg-faint
                   focus:inset-ring-1 focus:inset-ring-focus-ring/70"
      />

      {error && (
        <p className="mt-2 shrink-0 px-0.5 text-xs leading-snug text-status-rejected/90">
          {error}
        </p>
      )}

      <div
        role="list"
        className="mt-2 min-h-0 flex-1 overflow-y-auto scrollbar-thin"
      >
        {suggestions.map((name, index) => (
          <div key={name} role="listitem">
            <button
              type="button"
              disabled={pending}
              onClick={() => void create(name)}
              onMouseMove={() => setHighlight(index)}
              className={clsx(
                `flex w-full items-baseline rounded-md px-2.5 py-1.5 text-left
                 text-sm text-fg-secondary outline-none hover:bg-fg/[0.06]
                 focus-visible:ring-1 focus-visible:ring-focus-ring/70`,
                index === highlight && "bg-fg/[0.06]",
              )}
            >
              <span className="min-w-0 truncate">{name}</span>
            </button>
          </div>
        ))}
        {branch.trim() && !branches.includes(branch.trim()) && (
          <p className="px-2.5 py-1.5 text-xs text-fg-faint">
            Enter creates “{branch.trim()}” at this repo’s HEAD.
          </p>
        )}
      </div>
    </div>
  );
}
