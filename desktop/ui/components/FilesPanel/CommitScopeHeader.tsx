import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { commitsInScope } from "./commitScope";

/**
 * Commit context shown beneath the filter row when the queue is scoped to a
 * commit (CommitScopePicker): a single commit's full subject + body — the
 * same context a commit group's expandable blurb used to show — or, for a
 * range, a compact one-line-per-commit list.
 */
export function CommitScopeHeader(): ReactNode {
  const scope = useReviewStore((s) => s.scope);
  const attribution = useReviewStore((s) => s.attribution);

  if (!scope || scope.source !== "commit") return null;
  const commits = commitsInScope(scope, attribution ?? null);
  if (commits.length === 0) return null;

  if (commits.length === 1) {
    const c = commits[0];
    return (
      <div className="border-b border-edge-default/40 px-3 py-2">
        <p className="text-xs font-medium text-fg-secondary">{c.message}</p>
        {c.body && (
          <p className="mt-1 whitespace-pre-line text-xxs text-fg-muted">
            {c.body}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0.5 border-b border-edge-default/40 px-3 py-2">
      {commits.map((c) => (
        <p key={c.hash} className="truncate text-xxs text-fg-muted">
          <span className="mr-1.5 font-mono text-fg-faint">{c.shortHash}</span>
          {c.message}
        </p>
      ))}
    </div>
  );
}
