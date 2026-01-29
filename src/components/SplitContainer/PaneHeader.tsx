import type { SplitOrientation } from "../../stores/slices/navigationSlice";
import { SimpleTooltip } from "../ui/tooltip";

interface PaneHeaderProps {
  label: string;
  isFocused: boolean;
  showSwap?: boolean;
  showClose?: boolean;
  showOrientationToggle?: boolean;
  orientation?: SplitOrientation;
  onSwap?: () => void;
  onClose?: () => void;
  onToggleOrientation?: () => void;
}

export function PaneHeader({
  label,
  isFocused,
  showSwap,
  showClose,
  showOrientationToggle,
  orientation,
  onSwap,
  onClose,
  onToggleOrientation,
}: PaneHeaderProps) {
  const isHorizontal = orientation === "horizontal";

  return (
    <div
      className={`flex items-center justify-between border-b px-2 py-1 text-xxs ${
        isFocused
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-stone-800 bg-stone-900/50"
      }`}
    >
      <span
        className={`font-medium ${isFocused ? "text-amber-400" : "text-stone-500"}`}
      >
        {label}
      </span>
      <div className="flex items-center gap-1">
        {showOrientationToggle && onToggleOrientation && (
          <SimpleTooltip
            content={`Switch to ${isHorizontal ? "vertical" : "horizontal"} split`}
          >
            <button
              onClick={onToggleOrientation}
              className="flex h-5 w-5 items-center justify-center rounded text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors"
            >
              <svg
                className={`h-3 w-3 ${isHorizontal ? "" : "rotate-90"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 4v16M15 4v16"
                />
              </svg>
            </button>
          </SimpleTooltip>
        )}
        {showSwap && onSwap && (
          <SimpleTooltip content="Swap panes">
            <button
              onClick={onSwap}
              className="flex h-5 w-5 items-center justify-center rounded text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                />
              </svg>
            </button>
          </SimpleTooltip>
        )}
        {showClose && onClose && (
          <SimpleTooltip content="Close split">
            <button
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </SimpleTooltip>
        )}
      </div>
    </div>
  );
}
