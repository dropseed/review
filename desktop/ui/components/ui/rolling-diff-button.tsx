import { type ReactNode } from "react";
import { RollingDiffIcon } from "./icons";

interface RollingDiffButtonProps {
  /** Accessible label + tooltip text. Defaults to "View as rolling diff". */
  label?: string;
  onClick: () => void;
  /** Set when the section has no hunks to view — kept visible rather than
   * hidden, since the header row it sits in is otherwise stable. */
  disabled?: boolean;
}

/**
 * Section-header icon button that opens a multi-file rolling-diff view for
 * whatever scope the section represents. Stops click propagation so it works
 * inside a CollapsibleSection without also toggling the section.
 */
export function RollingDiffButton({
  label = "View as rolling diff",
  onClick,
  disabled = false,
}: RollingDiffButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
        disabled
          ? "text-fg-faint"
          : "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised"
      }`}
      aria-label={label}
      title={label}
    >
      <RollingDiffIcon />
    </button>
  );
}
