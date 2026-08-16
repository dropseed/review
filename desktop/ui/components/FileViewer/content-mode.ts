import type { DiffViewMode } from "../../stores/slices/preferencesSlice";

export type ContentMode =
  | { type: "image" }
  | { type: "svg"; hasRendered: boolean }
  | { type: "markdown" }
  | { type: "diff"; viewMode: DiffViewMode }
  | { type: "plain" };

/**
 * Whether this *content* is the kind the minimap is drawn beside.
 *
 * Only half the question — a diff in a pane too narrow to spare the column
 * doesn't get one either. That half belongs to the viewer, which is the thing
 * that knows how wide it is; see `FileViewer`, which combines the two and hands
 * the single answer down, because the minimap replaces the native scrollbar and
 * a disagreement means a view with neither.
 */
export function showsMinimap(mode: ContentMode): boolean {
  return mode.type === "diff";
}
