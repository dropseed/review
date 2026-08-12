import type { DiffViewMode } from "../../stores/slices/preferencesSlice";

export type ContentMode =
  | { type: "image" }
  | { type: "svg"; hasRendered: boolean }
  | { type: "markdown" }
  | { type: "diff"; viewMode: DiffViewMode }
  | { type: "plain" };

/**
 * Whether the file viewer draws the minimap beside this content. The minimap
 * is the scrollbar while it is up, so whoever renders the code view must hide
 * the native one under exactly this condition.
 */
export function showsMinimap(mode: ContentMode): boolean {
  return mode.type === "diff";
}
