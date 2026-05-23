import { type ReactNode } from "react";
import { RollingDiffIcon } from "./icons";

interface RollingDiffButtonProps {
  /** Accessible label + tooltip text. Defaults to "View as rolling diff". */
  label?: string;
  onClick: () => void;
}

/**
 * Section-header icon button that opens a multi-file rolling-diff view for
 * whatever scope the section represents. Stops click propagation so it works
 * inside a CollapsibleSection without also toggling the section.
 */
export function RollingDiffButton({
  label = "View as rolling diff",
  onClick,
}: RollingDiffButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center justify-center w-6 h-6 rounded
                 text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
      aria-label={label}
      title={label}
    >
      <RollingDiffIcon />
    </button>
  );
}
