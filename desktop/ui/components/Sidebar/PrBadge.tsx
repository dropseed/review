import { type ReactNode } from "react";
import { clsx } from "clsx";
import type { ViewerPr } from "../../types";
import { PullRequestDraftIcon, PullRequestIcon } from "../ui/icons";
import { prBadgeClass, prSummary } from "./pr-format";

interface PrBadgeProps {
  pr: ViewerPr;
  className?: string;
}

/**
 * "You have a PR out on this, and here is how it's doing."
 *
 * GitHub's own octicon in GitHub's own colours, so a row means the same thing
 * here as on the page it describes. Draft gets the dotted `git-pull-request-
 * draft` mark rather than only a duller colour: the state then survives being
 * scanned at 12px, and survives a reader who can't separate the grey from the
 * green at all.
 *
 * It sits in the row's status cluster beside the tier and worktree markers,
 * because having a PR open is the same kind of fact those are: something true
 * about the row that the row's name can't say.
 *
 * A native `title` rather than the tooltip primitive, matching the other
 * markers in the cluster: this badge can land on every row in the sidebar, and
 * each Radix tooltip is a mounted trigger carrying its own listeners.
 *
 * Like every marker here it does not animate — see `PhaseDot` for why nothing
 * in this sidebar pulses.
 */
export function PrBadge({ pr, className }: PrBadgeProps): ReactNode {
  const Icon = pr.isDraft ? PullRequestDraftIcon : PullRequestIcon;
  return (
    <span
      className={clsx("shrink-0", prBadgeClass(pr), className)}
      title={prSummary(pr)}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}
