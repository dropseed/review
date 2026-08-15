import { useEffect, useState } from "react";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import { browseRef } from "../../stores/selectors/browse";
import type { FileEntry, RefDescription } from "../../types";

export interface BrowseRefTree {
  /** The tree at the pinned ref; empty while unpinned or still loading. */
  entries: FileEntry[];
  /** What the pinned ref names — the banner's subtitle. */
  description: RefDescription | null;
  loading: boolean;
  error: string | null;
}

const NO_ENTRIES: FileEntry[] = [];
const UNPINNED: BrowseRefTree = {
  entries: NO_ENTRIES,
  description: null,
  loading: false,
  error: null,
};

/**
 * The repository's file tree as of the pinned ref, and what that ref names.
 *
 * Local to the panel rather than folded into the store's `allFiles`: this is a
 * read of the object database that only Browse consumes, and keeping it
 * separate is what stops a pinned peek from redrawing the Review tab's
 * sections — which describe the working tree — underneath it.
 */
export function useBrowseRefTree(): BrowseRefTree {
  const repoPath = useReviewStore((s) => s.repoPath);
  const ref = useReviewStore(browseRef);
  const [state, setState] = useState<BrowseRefTree>(UNPINNED);

  useEffect(() => {
    if (!repoPath || !ref) {
      setState(UNPINNED);
      return;
    }

    let cancelled = false;
    setState({ ...UNPINNED, loading: true });

    const api = getApiClient();
    Promise.all([
      api.listFilesAtRef(repoPath, ref),
      api.describeRef(repoPath, ref),
    ])
      .then(([entries, description]) => {
        if (cancelled) return;
        setState({ entries, description, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ ...UNPINNED, error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, ref]);

  return state;
}
