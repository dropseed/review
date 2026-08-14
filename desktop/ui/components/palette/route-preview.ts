/**
 * How a route preview reads on a ⌘K row.
 *
 * Only the wording lives here — the decision itself is `previewRoute` in
 * `stores/selectors/workspaceData`, beside the rest of the workspace rules, so
 * the preview and the landing cannot answer differently.
 */

import type { RoutePreview } from "../../stores/selectors/workspaceData";

export function routePreviewLabel(preview: RoutePreview): string {
  switch (preview.kind) {
    case "join":
      return `\u2192 joins ${preview.workspace.displayTitle}`;
    case "new":
      return "\u2192 new workspace";
  }
}
