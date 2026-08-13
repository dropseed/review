import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { formatAge } from "../../utils/format-age";
import type { ViewerPr } from "../../types";
import { WarningIcon } from "../ui/icons";
import { SimpleTooltip } from "../ui/tooltip";
import { ActionContextMenu } from "./ActionMenu";
import { externalActions } from "./work-actions";
import { PrBadge } from "./PrBadge";

/** The Unix epoch — what the backend stamps on a snapshot it never fetched. */
const NEVER_FETCHED = 0;

/**
 * The honesty marker.
 *
 * Everything else in the repos layer is data; this is the statement that the
 * data might be wrong. It renders whenever a fetch that could have worked
 * failed, whether or not any PRs came back, because the failure mode this whole
 * feature has to avoid is a sidebar that looks calm because `gh` is broken.
 *
 * "Could have worked" is the whole of `available`: a machine with no `gh`, or
 * one that never logged in, is not a broken fetch — it's a user who doesn't
 * have this feature, and a permanent warning they can do nothing about is
 * noise. That case renders nothing at all.
 */
function SnapshotWarning({
  error,
  fetchedAt,
}: {
  error: string;
  fetchedAt: string;
}): ReactNode {
  const at = new Date(fetchedAt).getTime();
  const age =
    Number.isNaN(at) || at === NEVER_FETCHED ? null : formatAge(fetchedAt);

  return (
    <SimpleTooltip
      side="right"
      content={
        <span>
          GitHub: {error}
          {age ? ` — showing PRs from ${age} ago` : " — no PRs fetched yet"}
        </span>
      }
    >
      <span className="flex items-center gap-1 text-fg-faint/70">
        <WarningIcon className="h-3 w-3 shrink-0" />
        <span className="text-[10px]">GitHub unavailable</span>
      </span>
    </SimpleTooltip>
  );
}

/**
 * Its own note, not a clause in the warning's tooltip.
 *
 * A truncated snapshot is a successful fetch, so it has no error to ride along
 * with — hanging it off one meant the only case where PRs are actually missing
 * from the sidebar was the case you couldn't be told about.
 */
function TruncationNote(): ReactNode {
  return (
    <SimpleTooltip
      side="right"
      content={
        <span>
          You have more than 100 open PRs; the rest aren&rsquo;t shown here.
        </span>
      }
    >
      <span className="text-[10px] text-fg-faint/60">showing newest 100</span>
    </SimpleTooltip>
  );
}

/**
 * What the PR snapshot itself has to admit to, as a line under the repos.
 *
 * The repos are drawn from the snapshot as much as from disk — a repo that
 * isn't cloned here appears only because a PR in it did — so a broken or
 * truncated fetch is missing *repos*, not just rows inside them. Renders
 * nothing when there is nothing to admit, which is the usual case.
 */
export function SnapshotNote(): ReactNode {
  const snapshot = useReviewStore((s) => s.viewerPrs);
  // No snapshot yet is not the same as no GitHub: assume the feature exists
  // until a snapshot says otherwise, or the first paint would flash a warning.
  const available = snapshot?.available ?? true;
  const error = available ? (snapshot?.error ?? null) : null;
  const truncated = available && (snapshot?.truncated ?? false);

  if (error == null && !truncated) return null;

  return (
    <div className="flex items-center gap-2 px-2.5 pt-1">
      {error != null && (
        <SnapshotWarning
          error={error}
          fetchedAt={snapshot?.fetchedAt ?? new Date(0).toISOString()}
        />
      )}
      {truncated && <TruncationNote />}
    </div>
  );
}

/**
 * An open PR in a repo this machine doesn't have.
 *
 * Quiet by construction: no liveness, no presence marker, no keyboard position.
 * Clicking one opens GitHub, because nothing local exists for it to open
 * instead — it is a reminder and a link out, not work you can start here.
 */
export function ElsewherePrRow({ pr }: { pr: ViewerPr }): ReactNode {
  return (
    <ActionContextMenu actions={externalActions("unclonedPr", pr.url)}>
      <button
        type="button"
        onClick={() => {
          getPlatformServices()
            .opener.openUrl(pr.url)
            .catch((err) => console.error("Failed to open PR:", err));
        }}
        className="group flex w-full items-center gap-1.5 rounded px-2.5 py-1 text-left
                   hover:bg-fg/[0.03] transition-colors duration-100"
        title={`${pr.repoNameWithOwner} — #${pr.number}: ${pr.title}`}
      >
        <span className="min-w-0 flex-1 truncate text-xs text-fg-faint/60 group-hover:text-fg-faint">
          <span className="tabular-nums">#{pr.number}</span> {pr.title}
        </span>
        <PrBadge pr={pr} />
      </button>
    </ActionContextMenu>
  );
}
