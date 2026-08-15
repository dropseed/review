import { type ReactNode, useEffect, useState } from "react";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import { ephemeralView } from "../../stores/selectors/ephemeral";
import type { CommitEntry } from "../../types";
import { formatAge } from "../../utils/format-age";
import { Spinner } from "../ui/spinner";
import { truncateSubject } from "./commitFormat";
import { openCommitView } from "./openCommit";

/**
 * How far back the list goes. A log is a way in to a commit, not a place to
 * read history — anything older is what the ref control above is for.
 */
const LIMIT = 50;

/** One fetch's outcome, modelled as `useBrowseRefTree` models its own. */
interface CommitLogState {
  entries: CommitEntry[];
  loading: boolean;
  error: string | null;
}

const EMPTY: CommitLogState = { entries: [], loading: false, error: null };

/**
 * A ref's recent commits, each one openable.
 *
 * Deliberately flat: no graph, no lanes. The question this answers is "which
 * commit do I want to look at", and every pixel spent drawing how branches
 * merged is a pixel not spent on the subject line that actually answers it.
 */
export function CommitLog({ gitRef }: { gitRef: string | null }): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const viewing = useReviewStore(ephemeralView);
  const [state, setState] = useState<CommitLogState>(EMPTY);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setState({ ...EMPTY, loading: true });

    getApiClient()
      .listCommits(repoPath, LIMIT, gitRef ?? undefined)
      .then((entries) => {
        if (!cancelled) setState({ entries, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to list commits:", err);
        setState({ ...EMPTY, error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, gitRef]);

  if (state.loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  if (state.error) {
    return (
      <p className="px-3 py-4 text-xxs text-status-rejected">{state.error}</p>
    );
  }

  if (state.entries.length === 0) {
    return <p className="py-4 text-center text-xs text-fg-muted">No commits</p>;
  }

  return (
    <div className="max-h-72 overflow-y-auto scrollbar-thin py-0.5">
      {state.entries.map((commit) => (
        <button
          key={commit.hash}
          type="button"
          onClick={() => void openCommitView(commit.hash)}
          title={commit.message}
          className={`flex w-full flex-col gap-0.5 px-3 py-1 text-left
                      hover:bg-fg/[0.06] focus-visible:outline-none
                      focus-visible:inset-ring-2 focus-visible:inset-ring-focus-ring/50 ${
                        commit.hash === viewing?.hash
                          ? "bg-focus-ring/10"
                          : undefined
                      }`}
        >
          <span className="w-full truncate text-xs text-fg-secondary">
            {truncateSubject(commit.message, 60)}
          </span>
          <span className="flex w-full items-center gap-1.5 text-xxs text-fg-faint">
            <span className="shrink-0 font-mono">{commit.shortHash}</span>
            <span className="min-w-0 flex-1 truncate">{commit.author}</span>
            <span className="shrink-0 tabular-nums">
              {formatAge(commit.date)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
