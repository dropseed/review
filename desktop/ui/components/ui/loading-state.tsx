import type { ReactNode } from "react";
import { Spinner } from "./spinner";

/**
 * The one loading treatment: a spinner over a muted label. Centering within
 * whatever space the caller gives it is the caller's layout decision, so this
 * is just the column.
 */
export function LoadingState({ label }: { label: string }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3">
      <Spinner className="size-5 border-2 border-edge-default border-t-status-modified" />
      <span className="text-sm text-fg-muted">{label}</span>
    </div>
  );
}
