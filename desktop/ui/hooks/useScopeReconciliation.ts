import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { useAllHunks } from "../stores/selectors/hunks";

/**
 * Reconciles a stale review scope against the loaded diff (e.g. a rebase or
 * amend changed the hunk set out from under it): prunes hunk IDs that no
 * longer exist, and only clears the scope outright once none of its hunks
 * survive. A partial prune (rather than always clearing) matters because
 * `countUnreviewed` counts a missing hunk ID as "unreviewed" forever —
 * leaving phantom IDs in place would strand the scope's progress short of
 * complete with no way to finish it.
 */
export function useScopeReconciliation(): void {
  const hunks = useAllHunks();
  const scope = useReviewStore((s) => s.scope);
  const setScope = useReviewStore((s) => s.setScope);

  useEffect(() => {
    if (!scope || scope.hunkIds.length === 0) return;
    const currentIds = new Set(hunks.map((h) => h.id));
    const surviving = scope.hunkIds.filter((id) => currentIds.has(id));
    if (surviving.length === 0) {
      setScope(null);
    } else if (surviving.length !== scope.hunkIds.length) {
      setScope({ ...scope, hunkIds: surviving });
    }
  }, [hunks, scope, setScope]);
}
