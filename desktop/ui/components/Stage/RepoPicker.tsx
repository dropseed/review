import { type ReactNode, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { scoreCandidate } from "../../lib/fuzzy";
import {
  repoChoiceKey,
  shortPath,
  useRepoChoices,
  type RepoChoice,
} from "./repo-choices";

/**
 * How many checkouts a pick is ever chosen from. The list is a shortlist, not
 * an inventory — anything past it is one keystroke of search away, and a column
 * of rows long enough to scroll asks to be read rather than typed at.
 *
 * A little longer than it was now that a repo's worktrees are rows of their
 * own: at seven, a single repo mid-rebase could fill the whole list and hide
 * that there are other repos at all.
 */
const MAX_ROWS = 10;

/**
 * The list of checkouts a workspace can open, filtered as you type.
 *
 * One list for both front doors — the repo tab bar's `+` and the empty state's
 * right half — because "which repo" is one question and two answers to it would
 * drift on ordering and on what counts as a repo. The caller supplies the frame
 * (a popover, or a panel) and what happens on a pick.
 */
export function RepoPicker({
  attached,
  onPick,
  autoFocus = false,
}: {
  /**
   * `repoChoiceKey`s already open in this workspace, marked so a pick reads as
   * a jump. Keyed by repo *and* ref: a repo's worktrees are separate rows, and
   * only the one the tab is actually pointed at is the one already open.
   */
  attached: ReadonlySet<string>;
  onPick: (choice: RepoChoice) => void;
  autoFocus?: boolean;
}): ReactNode {
  const choices = useRepoChoices();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return choices.slice(0, MAX_ROWS);
    return choices
      .map((choice) => ({
        choice,
        score:
          scoreCandidate(trimmed, [
            { key: "name", text: choice.name, weight: 1 },
            // Nearly as heavily as the name: a worktree is reached for by the
            // branch it holds, which is the only thing distinguishing its row
            // from the repo's own.
            { key: "ref", text: choice.refName ?? "", weight: 0.9 },
            { key: "path", text: choice.path, weight: 0.6 },
          ])?.score ?? 0,
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS)
      .map((scored) => scored.choice);
  }, [choices, query]);

  // Two repos called the same thing are told apart by where they are. Counted
  // over distinct *paths* rather than over rows: a repo and its worktrees are
  // all one repo under one name, and counting rows would make every repo that
  // has a worktree look ambiguous with itself.
  const ambiguous = useMemo(() => {
    const firstPath = new Map<string, string>();
    const names = new Set<string>();
    for (const choice of shown) {
      const seen = firstPath.get(choice.name);
      if (seen === undefined) firstPath.set(choice.name, choice.path);
      else if (seen !== choice.path) names.add(choice.name);
    }
    return names;
  }, [shown]);

  const at = Math.min(highlight, Math.max(shown.length - 1, 0));

  function handleKeyDown(event: React.KeyboardEvent): void {
    // Escape unwinds one step at a time: the query, then the focus — so the
    // frame around us (a popover) only closes once there is nothing left here
    // to undo.
    if (event.key === "Escape" && query) {
      event.stopPropagation();
      setQuery("");
      return;
    }
    if (event.key === "Escape") {
      inputRef.current?.blur();
      return;
    }
    // Every other key is ours: the app's own shortcuts must not fire while
    // someone is typing a repo name at them.
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = at + (event.key === "ArrowDown" ? 1 : -1);
      if (next >= 0 && next < shown.length) setHighlight(next);
      return;
    }
    if (event.key === "Enter" && shown[at]) {
      event.preventDefault();
      onPick(shown[at]);
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
        aria-label="Find a repo"
        placeholder="Find a repo…"
        className="w-full shrink-0 rounded-md bg-fg/[0.06] px-3 py-1.5 text-sm
                   text-fg-secondary outline-none placeholder:text-fg-faint
                   focus:inset-ring-1 focus:inset-ring-focus-ring/70"
      />

      <div
        role="list"
        className="mt-2 min-h-0 flex-1 overflow-y-auto scrollbar-thin"
      >
        {shown.length === 0 ? (
          <p className="px-2.5 py-1.5 text-sm text-fg-faint">
            {choices.length === 0 ? "No repos yet." : "Nothing matches."}
          </p>
        ) : (
          shown.map((choice, index) => {
            const key = repoChoiceKey(choice.path, choice.refName);
            const isOpen = attached.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onPick(choice)}
                onMouseMove={() => setHighlight(index)}
                title={choice.worktreePath ?? choice.path}
                className={clsx(
                  `flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5
                 text-left text-sm outline-none hover:bg-fg/[0.06]
                 focus-visible:ring-1 focus-visible:ring-focus-ring/70`,
                  index === at && "bg-fg/[0.06]",
                )}
              >
                {/* The repo name is capped rather than flexible, so it gives
                    up its space before it gives up its identity: with six
                    worktrees of one repo listed, an evenly-shrinking row
                    truncated every column at once and left a column of
                    "pullapp…" against "pulla…" — six rows that looked
                    identical and differed only in the part that had been
                    truncated away. */}
                <span
                  className={clsx(
                    "max-w-[45%] shrink-0 truncate",
                    isOpen ? "text-fg-muted" : "text-fg-secondary",
                  )}
                >
                  {choice.name}
                </span>
                {/* The ref takes what's left, because on a list of one repo's
                    checkouts it is the only thing telling them apart — the
                    name is the same word six times. */}
                {choice.refName && (
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-faint">
                    {choice.refName}
                  </span>
                )}
                {/* Last in the shrink order and last on the row: the path only
                    ever separates two *repos* of the same name, so on a list of
                    one repo's branches it repeats itself and is worth nothing.
                    `ml-auto` on it alone keeps the trailing edge stable whether
                    or not the row has a ref. */}
                {ambiguous.has(choice.name) && (
                  <span className="ml-auto max-w-[45%] shrink truncate text-xs text-fg-faint/70">
                    {shortPath(choice.path)}
                  </span>
                )}
                {isOpen && (
                  <span className="ml-auto shrink-0 text-xs text-fg-faint">
                    open
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
