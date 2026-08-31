import { useEffect, useState } from "react";
import { getApiClient } from "../../api";
import { useSpurStore } from "../../stores";
import { activeHistoricRef } from "../../stores/selectors/viewpoint";
import type { FileEntry } from "../../types";

export interface BrowseRefTree {
  /** The tree at that revision; empty at the working tree or still loading. */
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
}

const NO_ENTRIES: FileEntry[] = [];
const WORKING_TREE: BrowseRefTree = {
  entries: NO_ENTRIES,
  loading: false,
  error: null,
};

/**
 * The repository's file tree as of the revision Browse is reading at. Empty
 * while it is reading the working tree, which is what `allFiles` already
 * describes. What that revision *is* is the comparison bar's to say.
 *
 * Local to the panel rather than folded into the store's `allFiles`: this is a
 * read of the object database that only Browse consumes, and keeping it
 * separate is what stops it from redrawing the Review tab's sections — which
 * describe the working tree — underneath it. Asked of the *active* revision so
 * a repo nobody is browsing is never listed at all.
 */
export function useBrowseRefTree(): BrowseRefTree {
  const repoPath = useSpurStore((s) => s.repoPath);
  const ref = useSpurStore(activeHistoricRef);
  const [state, setState] = useState<BrowseRefTree>(WORKING_TREE);

  useEffect(() => {
    if (!repoPath || !ref) {
      setState(WORKING_TREE);
      return;
    }

    let cancelled = false;
    setState({ ...WORKING_TREE, loading: true });

    getApiClient()
      .listFilesAtRef(repoPath, ref)
      .then((entries) => {
        if (cancelled) return;
        setState({ entries, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ ...WORKING_TREE, error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, ref]);

  return state;
}
