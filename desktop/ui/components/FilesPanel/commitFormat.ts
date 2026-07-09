// Small formatting helpers shared by every commit-oriented UI surface
// (provenance tags in the diff viewer, the Review tab's commit grouping,
// and the Git tab's commit list). Kept dependency-free so none of them
// have to import a UI component just to get one.

/** Truncate a commit subject line for compact display (tags, chips, etc.). */
export function truncateSubject(subject: string, maxLength = 48): string {
  if (subject.length <= maxLength) return subject;
  return `${subject.slice(0, maxLength - 1).trimEnd()}…`;
}
