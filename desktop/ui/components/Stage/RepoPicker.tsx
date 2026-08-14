import { type ReactNode, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { scoreCandidate } from "../../lib/fuzzy";
import { shortPath, useRepoChoices, type RepoChoice } from "./repo-choices";

/**
 * How many repos a pick is ever chosen from. The list is a shortlist, not an
 * inventory — anything past it is one keystroke of search away, and a column of
 * rows long enough to scroll asks to be read rather than typed at.
 */
const MAX_ROWS = 7;

/**
 * The list of repos a workspace can open, filtered as you type.
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
  /** Paths already open in this workspace, marked so a pick reads as a jump. */
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
            { key: "path", text: choice.path, weight: 0.6 },
          ])?.score ?? 0,
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS)
      .map((scored) => scored.choice);
  }, [choices, query]);

  // Two repos called the same thing are told apart by where they are, not by
  // which branch they happen to be on — the branch is the useful line only
  // while the name already identifies the repo.
  const ambiguous = useMemo(() => {
    const seen = new Map<string, number>();
    for (const choice of shown) {
      seen.set(choice.name, (seen.get(choice.name) ?? 0) + 1);
    }
    return new Set(
      [...seen].filter(([, count]) => count > 1).map(([name]) => name),
    );
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
          shown.map((choice, index) => (
            <button
              key={choice.path}
              type="button"
              onClick={() => onPick(choice)}
              onMouseMove={() => setHighlight(index)}
              title={choice.path}
              className={clsx(
                `flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5
                 text-left text-sm outline-none hover:bg-fg/[0.06]
                 focus-visible:ring-1 focus-visible:ring-focus-ring/70`,
                index === at && "bg-fg/[0.06]",
              )}
            >
              <span
                className={clsx(
                  "min-w-0 truncate",
                  attached.has(choice.path)
                    ? "text-fg-muted"
                    : "text-fg-secondary",
                )}
              >
                {choice.name}
              </span>
              {ambiguous.has(choice.name) ? (
                <span className="min-w-0 truncate text-xs text-fg-faint">
                  {shortPath(choice.path)}
                </span>
              ) : (
                choice.refName && (
                  <span className="min-w-0 truncate text-xs text-fg-faint">
                    {choice.refName}
                  </span>
                )
              )}
              {attached.has(choice.path) && (
                <span className="ml-auto shrink-0 text-xs text-fg-faint">
                  open
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
