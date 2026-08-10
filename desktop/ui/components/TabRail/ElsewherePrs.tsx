import { type ReactNode, useMemo, useState } from "react";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { groupPrsElsewhere } from "../../utils/sidebar-tree";
import { formatAge } from "../../utils/format-age";
import type { ViewerPr } from "../../types";
import { WarningIcon } from "../ui/icons";
import { SimpleTooltip } from "../ui/tooltip";
import { PrBadge } from "./PrBadge";

/** The Unix epoch — what the backend stamps on a snapshot it never fetched. */
const NEVER_FETCHED = 0;

/**
 * The honesty marker.
 *
 * Everything else in this section is data; this is the statement that the data
 * might be wrong. It renders whenever a fetch that could have worked failed,
 * whether or not any PRs came back, because the failure mode this whole feature
 * has to avoid is a sidebar that looks calm because `gh` is broken.
 *
 * "Could have worked" is the whole of `available`: a machine with no `gh`, or
 * one that never logged in, is not a broken fetch — it's a user who doesn't
 * have this feature, and a permanent warning they can do nothing about is
 * noise. That case renders nothing at all; see `ElsewherePrs`.
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
 * Its own line, not a clause in the warning's tooltip.
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

function ElsewhereRow({ pr }: { pr: ViewerPr }): ReactNode {
  return (
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
  );
}

/**
 * Open PRs in repos this machine doesn't have.
 *
 * Collapsed by default and quiet by construction: no liveness, no presence
 * markers, no keyboard position in the tree. They are a reminder and a link
 * out, not work you can start here — clicking one opens GitHub, because
 * nothing local exists for it to open instead.
 *
 * It sits at the foot of the sidebar under `quiet repos` for the same reason
 * that section does: the list above is what you can act on, and anything that
 * pushes it off screen is a cost paid every time you look at the sidebar.
 */
export function ElsewherePrs(): ReactNode {
  const snapshot = useReviewStore((s) => s.viewerPrs);
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () => groupPrsElsewhere(snapshot?.prs ?? []),
    [snapshot?.prs],
  );

  const count = groups.reduce((n, group) => n + group.prs.length, 0);
  // No snapshot yet is not the same as no GitHub: assume the feature exists
  // until a snapshot says otherwise, or the first paint would flash nothing.
  const available = snapshot?.available ?? true;
  const error = available ? (snapshot?.error ?? null) : null;
  const truncated = available && (snapshot?.truncated ?? false);

  if (!available) return null;
  if (count === 0 && error == null && !truncated) return null;

  return (
    <div className="mt-1.5 border-t border-t-edge/40 pt-1">
      <div className="flex items-center gap-2 px-2.5">
        {count > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex flex-1 items-center gap-1 -mx-1 px-1 py-1 rounded-sm text-left
                       text-[10px] text-fg-faint/70 hover:text-fg-muted
                       hover:bg-fg/[0.03] transition-colors duration-100"
          >
            <span className="w-2 shrink-0 text-[8px]">{open ? "▾" : "▸"}</span>
            <span>
              Elsewhere on GitHub &middot;{" "}
              <span className="tabular-nums">{count}</span>
            </span>
          </button>
        )}
        {error != null && (
          <SnapshotWarning
            error={error}
            fetchedAt={snapshot?.fetchedAt ?? new Date(0).toISOString()}
          />
        )}
        {truncated && <TruncationNote />}
      </div>

      {open &&
        groups.map((group) => (
          <div key={group.repoNameWithOwner} className="mt-1 first:mt-1.5">
            <p className="truncate px-2.5 text-[10px] text-fg-faint/50">
              {group.repoNameWithOwner}
            </p>
            <div className="ml-[18px] border-l border-l-fg/[0.06]">
              {group.prs.map((pr) => (
                <ElsewhereRow key={pr.url} pr={pr} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
