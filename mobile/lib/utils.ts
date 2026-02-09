export const monoFont = process.env.EXPO_OS === "ios" ? "Menlo" : "monospace";

export function encodeReviewKey(
  repoPath: string,
  old: string,
  newRef: string,
  workingTree: boolean
): string {
  return btoa(
    JSON.stringify({ repo: repoPath, old, new: newRef, workingTree })
  );
}

export function decodeReviewKey(key: string): {
  repo: string;
  old: string;
  new: string;
  workingTree: boolean;
} {
  return JSON.parse(atob(key));
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
