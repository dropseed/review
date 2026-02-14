import type { HunkState } from "../api/types";

export function matchesPattern(label: string, pattern: string): boolean {
  if (!pattern.includes("*")) return label === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexPattern}$`).test(label);
}

export function isHunkTrusted(
  hunkState: HunkState | undefined,
  trustList: string[],
): boolean {
  if (!hunkState?.label || hunkState.label.length === 0) return false;
  for (const label of hunkState.label) {
    if (trustList.some((p) => matchesPattern(label, p))) {
      return true;
    }
  }
  return false;
}

export type HunkReviewStatus =
  | "approved"
  | "rejected"
  | "trusted"
  | "pending";

export function getHunkReviewStatus(
  hunkState: HunkState | undefined,
  trustList: string[],
): HunkReviewStatus {
  if (hunkState?.status === "approved") return "approved";
  if (hunkState?.status === "rejected") return "rejected";
  if (isHunkTrusted(hunkState, trustList)) return "trusted";
  return "pending";
}
