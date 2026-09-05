import { type ReactNode, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { rankCandidates } from "../../lib/fuzzy";
import type { WorktreeStatus } from "../../types";
import {
  chooseFolder,
  repoChoiceKey,
  shortPath,
  useRepoChoices,
  type RepoChoice,
} from "./repo-choices";
import { NewWorktreeForm } from "./NewWorktreeForm";
import { removeWorktreeAt } from "./worktree-actions";
import { useWorktreeInUse, useWorktreeStatus } from "./worktree-facts";

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
 *
 * It is also where worktrees are made and removed, for the same reason it is
 * where they are opened: the moment you are choosing which checkout to work in
 * is the moment you can see that one is missing, or that four are stale. The
 * facts on a row are the ones a git client would show — the branch, whether it
 * holds uncommitted work, whether Review made it, and whether anything in the
 * app is currently pointed at it.
 *
 * And it ends in "Open folder…", which is the same reason again: the list is
 * every checkout the app knows about, so the one gesture it cannot offer as a
 * row is the one that adds to it. `onPick` is how it leaves — the folder
 * arrives as an ordinary `RepoChoice`, so both front doors open it exactly as
 * they open a row.
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
  const [creatingIn, setCreatingIn] = useState<RepoChoice | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Distinct repos, in list order: a repo contributes a row per worktree, and
  // the status call takes each repository once.
  const repoPaths = useMemo(
    () => [...new Set(choices.map((choice) => choice.repoRoot))],
    [choices],
  );
  const { byPath, refresh } = useWorktreeStatus(repoPaths);
  const inUse = useWorktreeInUse();

  const shown = useMemo(
    () =>
      rankCandidates(
        query,
        choices,
        (choice) => [
          { key: "name", text: choice.name, weight: 1 },
          // Nearly as heavily as the name: a worktree is reached for by the
          // branch it holds, which is the only thing distinguishing its row
          // from the repo's own.
          { key: "ref", text: choice.refName ?? "", weight: 0.9 },
          { key: "path", text: choice.path, weight: 0.6 },
        ],
        MAX_ROWS,
      ),
    [choices, query],
  );

  // Two repos called the same thing are told apart by where they are. Counted
  // over distinct *repositories* rather than over rows: a repo and its
  // worktrees are all one repo under one name, and counting rows would make
  // every repo that has a worktree look ambiguous with itself.
  const ambiguous = useMemo(() => {
    const firstPath = new Map<string, string>();
    const names = new Set<string>();
    for (const choice of shown) {
      const seen = firstPath.get(choice.name);
      if (seen === undefined) firstPath.set(choice.name, choice.repoRoot);
      else if (seen !== choice.repoRoot) names.add(choice.name);
    }
    return names;
  }, [shown]);

  // The folder row is the last row, always: it is what you reach for when
  // nothing in the list is the answer, which includes the list being empty.
  const rowCount = shown.length + 1;
  const at = Math.min(highlight, rowCount - 1);
  const folderRowAt = shown.length;

  function openFolder(): void {
    void chooseFolder().then((choice) => {
      if (choice) onPick(choice);
    });
  }

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
      if (next >= 0 && next < rowCount) setHighlight(next);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (at === folderRowAt) openFolder();
      else if (shown[at]) onPick(shown[at]);
    }
  }

  // The form takes the whole body: one popover, one question at a time.
  if (creatingIn) {
    return (
      <NewWorktreeForm
        repo={creatingIn}
        onCancel={() => setCreatingIn(null)}
        onCreated={(choice) => {
          setCreatingIn(null);
          void refresh();
          onPick(choice);
        }}
      />
    );
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
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
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
            const isWorktreeChoice = choice.path !== choice.repoRoot;
            // Only rows standing for a directory on disk have a worktree to
            // report on, and only when the status read for that repo landed —
            // with no answer, a row is what it always was: somewhere to go.
            const worktree = isWorktreeChoice
              ? (byPath.get(choice.path) ?? null)
              : null;
            return (
              <div
                key={key}
                role="listitem"
                onMouseMove={() => setHighlight(index)}
                className={clsx(
                  "group/row flex items-center rounded-md hover:bg-fg/[0.06]",
                  index === at && "bg-fg/[0.06]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onPick(choice)}
                  title={choice.path}
                  className={`flex min-w-0 flex-1 items-baseline gap-2 rounded-md
                            px-2.5 py-1.5 text-left text-sm outline-none
                            focus-visible:ring-1 focus-visible:ring-focus-ring/70`}
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
                  {worktree && (
                    <WorktreeFacts
                      worktree={worktree}
                      unused={!isOpen && !inUse(choice.repoRoot, worktree)}
                    />
                  )}
                  {isOpen && (
                    <span className="ml-auto shrink-0 text-xs text-fg-faint">
                      open
                    </span>
                  )}
                </button>
                {/* The repo's own row makes worktrees; a worktree's row
                    removes itself. A worktree row with no status read is
                    neither — offering to delete a checkout we could not look
                    at is how a UI flag becomes a lost afternoon. */}
                {!isWorktreeChoice ? (
                  <RowAction
                    label={`New worktree in ${choice.name}`}
                    glyph="+"
                    onClick={() => setCreatingIn(choice)}
                  />
                ) : (
                  worktree && (
                    <RowAction
                      label={`Remove worktree ${worktree.branch ?? worktree.path}`}
                      glyph="×"
                      onClick={() => {
                        void removeWorktreeAt(choice.repoRoot, worktree).then(
                          (removed) => {
                            if (removed) void refresh();
                          },
                        );
                      }}
                    />
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Outside the list, because it is not one of the repos: the list is what
          the app already knows about, and this is how something it has never
          seen gets in. Shown on every platform — the web build's picker is a
          prompt for a path, which is the right question when the server is the
          machine holding the folder. */}
      <button
        type="button"
        onClick={openFolder}
        onMouseMove={() => setHighlight(folderRowAt)}
        className={clsx(
          `mt-1 flex shrink-0 items-baseline gap-2 rounded-md border-t border-edge/60
           px-2.5 py-1.5 text-left text-sm text-fg-muted outline-none
           hover:bg-fg/[0.06] hover:text-fg-secondary
           focus-visible:ring-1 focus-visible:ring-focus-ring/70`,
          at === folderRowAt && "bg-fg/[0.06]",
        )}
      >
        Open folder…
        <span className="min-w-0 flex-1 truncate text-xs text-fg-faint">
          any directory, repo or not
        </span>
      </button>
    </div>
  );
}

/**
 * What a git client would tell you about a checkout at a glance: whether it
 * holds uncommitted work, whether Review made it, and whether anything in the
 * app is pointed at it.
 *
 * Deliberately quiet. A worktree row is still just "this repo, at this branch",
 * and these are the states worth interrupting that for — the two that decide
 * whether a row can be deleted, and the one that says who it belongs to.
 */
function WorktreeFacts({
  worktree,
  unused,
}: {
  worktree: WorktreeStatus;
  unused: boolean;
}): ReactNode {
  return (
    <span className="ml-auto flex shrink-0 items-baseline gap-1.5 text-xs">
      {worktree.hasChanges && (
        <span className="text-status-modified" title="Uncommitted changes">
          ●
        </span>
      )}
      {worktree.isReviewManaged && (
        <span className="text-fg-faint/70" title="Spur made this worktree">
          review
        </span>
      )}
      {unused && (
        <span
          className="text-fg-faint/70"
          title="No workspace or terminal is using this worktree"
        >
          unused
        </span>
      )}
    </span>
  );
}

/**
 * The verb at the end of a row, revealed by hovering it.
 *
 * A sibling of the row button rather than a child: a button inside a button is
 * invalid, and the row's own click must stay "open this".
 */
function RowAction({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-md px-2 py-1.5 text-sm leading-none text-fg-faint
                 opacity-0 transition-opacity duration-100 hover:text-fg-secondary
                 focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      {glyph}
    </button>
  );
}
