import type { DiffViewMode } from "../../stores/slices/preferencesSlice";

export type ContentMode =
  | { type: "image" }
  | { type: "svg"; hasRendered: boolean }
  | { type: "markdown" }
  | { type: "untracked" }
  | { type: "diff"; viewMode: DiffViewMode }
  | { type: "plain" };
