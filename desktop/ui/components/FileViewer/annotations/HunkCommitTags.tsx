import type { CommitEntry } from "../../../types";
import { truncateSubject } from "../../FilesPanel/commitFormat";

interface HunkCommitTagsProps {
  /**
   * Commits that introduced this hunk's lines, oldest first. Empty array
   * renders an "uncommitted" tag; `null` means attribution isn't available
   * (loading, failed, or no commits in range) and nothing is rendered.
   */
  commits: CommitEntry[] | null;
  /** Scope the review to a single commit by clicking its tag. */
  onScopeToCommit: (sha: string) => void;
}

/**
 * Quiet per-hunk provenance chrome: which commit(s) introduced this hunk's
 * lines, derived from the comparison's hunk-to-commit attribution. Lives in
 * the hunk header/annotation panel next to the other badges (labels).
 */
export function HunkCommitTags({
  commits,
  onScopeToCommit,
}: HunkCommitTagsProps) {
  if (commits === null) return null;

  if (commits.length === 0) {
    return (
      <span
        className="text-xxs italic text-fg-faint/70"
        title="Not yet part of any commit"
      >
        uncommitted
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {commits.map((commit) => (
        <button
          key={commit.hash}
          type="button"
          onClick={() => onScopeToCommit(commit.hash)}
          title={
            commit.body ? `${commit.message}\n\n${commit.body}` : commit.message
          }
          className="rounded px-1 py-0.5 font-mono text-xxs text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-muted"
        >
          {commit.shortHash}{" "}
          <span className="font-sans">
            {truncateSubject(commit.message, 28)}
          </span>
        </button>
      ))}
    </div>
  );
}
