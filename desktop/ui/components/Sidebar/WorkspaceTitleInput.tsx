import { type ReactNode, useState } from "react";
import { useSpurStore } from "../../stores";

/**
 * Renaming a workspace in place, wherever its name is shown.
 *
 * Owns the write as well as the box: both callers wrapped this in the same
 * "only if it changed" guard, which is the kind of thing that stays identical
 * right up until it doesn't. Escape restores, blur and Enter commit, and
 * keystrokes are stopped from reaching the app's shortcuts — typing `1` into a
 * name must not jump to the first workspace.
 *
 * The box prefills from the *raw* title, not the displayed one: a workspace
 * showing a derived name has typed nothing, and starting the edit with the
 * derivation already in the box would turn every rename into an accidental
 * commitment to today's first repo. Clearing the box is the way back — an empty
 * save writes null and the title derives again.
 */
export function WorkspaceTitleInput({
  workspaceId,
  title,
  onDone,
  className,
}: {
  workspaceId: string;
  /** What the human typed, or null while the title derives. */
  title: string | null;
  /** Leave editing — the caller owns whether the box is showing. */
  onDone: () => void;
  className?: string;
}): ReactNode {
  const renameWorkspace = useSpurStore((s) => s.renameWorkspace);
  const [value, setValue] = useState(title ?? "");

  const commit = (next: string | null): void => {
    onDone();
    if (next !== title) void renameWorkspace(workspaceId, next);
  };

  return (
    <input
      autoFocus
      value={value}
      placeholder="Name this workspace"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => commit(value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(value.trim() || null);
        if (e.key === "Escape") commit(title);
      }}
      className={className}
    />
  );
}
