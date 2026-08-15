import { type ReactNode, useEffect, useMemo, useState } from "react";
import { getApiClient } from "../../api";
import { rankCandidates } from "../../lib/fuzzy";
import { useReviewStore } from "../../stores";
import { browseRef } from "../../stores/selectors/browse";
import type { RefDescription, RefEntry, RefKind } from "../../types";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { BranchIcon, PinIcon } from "../ui/icons";
import { Spinner } from "../ui/spinner";

/** How many refs a pick is ever chosen from — the rest are a keystroke away. */
const MAX_ROWS = 40;

const GROUP_LABELS: Record<RefKind, string> = {
  localBranch: "Branches",
  remoteBranch: "Remote branches",
  tag: "Tags",
};

const GROUP_ORDER: RefKind[] = ["localBranch", "remoteBranch", "tag"];

/**
 * The Browse tab's ref control: what revision the tree and the files below it
 * are being read at.
 *
 * Two states, deliberately unalike. Unpinned it is a quiet button saying
 * "Working tree" — the default, and the only state in which the panel shows
 * what is actually on disk. Pinned it is a banner: the ref, what it resolves
 * to, and a one-click way back to now. A peek at an old revision has to look
 * like one, because everything else on this screen (staging, comments, the
 * Review tab's counts) still belongs to the working tree.
 */
export function BrowseRefBar({
  description,
  loading,
  error,
}: {
  description: RefDescription | null;
  loading: boolean;
  error: string | null;
}): ReactNode {
  const pinned = useReviewStore(browseRef);
  const setBrowseRef = useReviewStore((s) => s.setBrowseRef);
  const [pickerOpen, setPickerOpen] = useState(false);

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={
          pinned
            ? `Browsing as of ${pinned} — change ref`
            : "Browse as of a ref"
        }
        className={
          pinned
            ? "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium text-status-modified hover:bg-fg/[0.08]"
            : "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-fg/[0.08] hover:text-fg-secondary"
        }
      >
        {pinned ? (
          <PinIcon className="size-3 shrink-0" filled />
        ) : (
          <BranchIcon className="size-3 shrink-0" />
        )}
        <span className="truncate">{pinned ?? "Working tree"}</span>
        <span aria-hidden="true" className="shrink-0 opacity-60">
          ▾
        </span>
      </button>
    </PopoverTrigger>
  );

  return (
    <div
      className={
        pinned
          ? "flex items-center gap-2 border-b border-status-modified/30 bg-status-modified/10 px-3 py-1.5"
          : "flex items-center gap-2 px-3 py-1.5"
      }
    >
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        {trigger}
        <PopoverContent align="start" className="max-h-96 w-80 p-2">
          <RefPicker
            pinned={pinned}
            onPick={(ref) => {
              setPickerOpen(false);
              setBrowseRef(ref);
            }}
          />
        </PopoverContent>
      </Popover>

      {pinned && (
        <>
          <span className="min-w-0 flex-1 truncate text-xxs text-fg-muted">
            {loading
              ? "Reading…"
              : error
                ? error
                : description
                  ? `${description.shortSha} · ${description.subject}`
                  : ""}
          </span>
          <button
            type="button"
            onClick={() => setBrowseRef(null)}
            className="shrink-0 rounded px-1.5 py-0.5 text-xxs font-medium text-fg-secondary
                       hover:bg-fg/[0.08] hover:text-fg"
          >
            Back to now
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The list of refs to pin to, filtered as you type, with the raw query offered
 * as a last row so a SHA or a revision expression can be pasted straight in.
 *
 * Only refs git already has locally are listed, and nothing is fetched to
 * build the list: browsing is a read, and a read should never reach the
 * network on the user's behalf.
 */
function RefPicker({
  pinned,
  onPick,
}: {
  pinned: string | null;
  onPick: (ref: string | null) => void;
}): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const [refs, setRefs] = useState<RefEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    getApiClient()
      .listRefs(repoPath)
      .then((result) => {
        if (!cancelled) setRefs(result);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to list refs:", err);
          setRefs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  const shown = useMemo(
    () => rankCandidates(query, refs ?? [], (entry) => entry.name, MAX_ROWS),
    [refs, query],
  );

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((kind) => ({
        kind,
        entries: shown.filter((entry) => entry.kind === kind),
      })).filter((group) => group.entries.length > 0),
    [shown],
  );

  // Nothing named this, but git may still resolve it: a SHA prefix, `HEAD~3`,
  // a tag in a submodule's namespace. Offered as a row rather than accepted
  // silently, so a typo is answered before the panel reloads under it.
  const typed = query.trim();
  const offerTyped =
    typed.length > 0 && !shown.some((entry) => entry.name === typed);

  async function pickTyped(): Promise<void> {
    if (!repoPath || !typed) return;
    try {
      await getApiClient().describeRef(repoPath, typed);
      onPick(typed);
    } catch {
      setTypedError(`Not a ref this repo knows: ${typed}`);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        value={query}
        placeholder="Branch, tag, or commit"
        onChange={(e) => {
          setQuery(e.target.value);
          setTypedError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (shown.length > 0) onPick(shown[0].name);
          else void pickTyped();
        }}
        className="h-8"
      />

      {typedError && (
        <p className="px-1 text-xxs text-status-rejected">{typedError}</p>
      )}

      <div className="max-h-72 overflow-y-auto scrollbar-thin">
        {pinned !== null && (
          <RefRow label="Working tree" onClick={() => onPick(null)} />
        )}

        {offerTyped && (
          <RefRow
            label={`Use “${typed}”`}
            hint="commit"
            onClick={() => void pickTyped()}
          />
        )}

        {refs === null ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : grouped.length === 0 && !offerTyped ? (
          <p className="py-4 text-center text-xs text-fg-muted">No refs</p>
        ) : (
          grouped.map((group) => (
            <div key={group.kind}>
              <p className="px-2 pt-2 pb-1 text-xxs font-medium text-fg-muted">
                {GROUP_LABELS[group.kind]}
              </p>
              {group.entries.map((entry) => (
                <RefRow
                  key={`${group.kind}:${entry.name}`}
                  label={entry.name}
                  selected={entry.name === pinned}
                  onClick={() => onPick(entry.name)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RefRow({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs
                  hover:bg-fg/[0.08] ${
                    selected ? "text-status-modified" : "text-fg-secondary"
                  }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xxs text-fg-muted">{hint}</span>}
    </button>
  );
}
