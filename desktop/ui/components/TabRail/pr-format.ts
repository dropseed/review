import type { ViewerPr } from "../../types";
import { prNeedsAttention } from "../../utils/sidebar-tree";

/**
 * Colour classes and label text for an open PR, kept JSX-free so the rules are
 * unit-testable and stated once for the badge, the row, and the elsewhere
 * bucket, which would otherwise each spell out their own version of "red means
 * something is wrong here".
 */

/**
 * A PR's colour, in GitHub's three PR states: red when something is blocked,
 * grey when it's a draft nobody is waiting on, green otherwise.
 *
 * Red comes from `prNeedsAttention` rather than being restated here, so the
 * badge turning red and the row entering the live zone are guaranteed to be
 * the same event.
 *
 * Order is the rule for the rest. Red outranks draft, because a draft with
 * failing CI or requested changes is exactly the draft worth noticing.
 * Approved has no branch of its own — GitHub paints approved and plain-open
 * the same green, and a fourth shade would invent a distinction the source
 * doesn't make. Note the badge tracks *state*, not age: a PR parked behind
 * `⋯ more` for being three months old still shows green, because "stale" is a
 * fact about the sidebar's attention, not about the PR.
 */
export function prBadgeClass(pr: ViewerPr): string {
  if (prNeedsAttention(pr)) return "text-pr-attention";
  if (pr.isDraft) return "text-pr-draft";
  return "text-pr-open";
}

const REVIEW_DECISION_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

const CHECKS_LABELS: Record<string, string> = {
  FAILURE: "CI failing",
  ERROR: "CI errored",
  PENDING: "CI running",
  SUCCESS: "CI passing",
};

/**
 * The badge's tooltip: `#97 · Draft · Changes requested · CI failing`.
 *
 * Absent parts are omitted rather than spelled out as "unknown" — a PR with no
 * CI configured and one whose checks haven't reported yet both say nothing,
 * because the colour already carries everything the row can honestly claim.
 * `EXPECTED` checks are among those: a check that has been announced but never
 * ran is not news.
 */
export function prSummary(pr: ViewerPr): string {
  const parts = [`#${pr.number}`];
  if (pr.isDraft) parts.push("Draft");
  const decision =
    pr.reviewDecision == null
      ? null
      : REVIEW_DECISION_LABELS[pr.reviewDecision];
  if (decision) parts.push(decision);
  const checks = pr.checksState == null ? null : CHECKS_LABELS[pr.checksState];
  if (checks) parts.push(checks);
  return parts.join(" · ");
}
