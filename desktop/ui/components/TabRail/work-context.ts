import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { sidebarRowsByKey } from "../../stores/selectors/sidebar";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { repoDisplayName } from "../../utils/repo-identity";
import type { WorkContext } from "./work-status";

/**
 * Everything the cards and the band join against, gathered once per section.
 *
 * Lives beside the rules rather than inside the section component: the rail and
 * the unclaimed-terminals band need the same join, and reaching it through a
 * component module made a hook the sibling of the JSX that happened to use it
 * first.
 *
 * The rows come from the same tree the list below renders, so a card and the
 * row it stands for can't disagree about a PR or a working tree.
 */
export function useWorkContext(): WorkContext {
  const tree = useSidebarTree();
  const localActivity = useReviewStore((s) => s.localActivity);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const reviews = useReviewStore((s) => s.globalReviewsByKey);

  return useMemo(() => {
    const repoNames = new Map<string, string>();
    const knownRepos = new Set<string>();
    for (const repo of localActivity) {
      knownRepos.add(repo.repoPath);
      repoNames.set(
        repo.repoPath,
        repoDisplayName(
          repoMetadata[repo.repoPath]?.routePrefix,
          repo.repoName,
        ),
      );
    }
    return { rows: sidebarRowsByKey(tree), repoNames, knownRepos, reviews };
  }, [tree, localActivity, repoMetadata, reviews]);
}
