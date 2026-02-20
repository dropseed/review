import type { ReactNode } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import type {
  ChangesDisplayMode,
  FileSortOrder,
} from "../../stores/slices/preferencesSlice";

const SORT_LABELS: Record<FileSortOrder, string> = {
  name: "Name",
  size: "Size",
  modified: "Last modified",
};

const SELECTED_CHECK = (
  <svg
    className="h-3 w-3 text-fg-secondary"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 13l4 4L19 7" />
  </svg>
);

/** Toolbar strip below the tab switcher -- compose children for each tab's needs. */
export function PanelToolbar({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-end gap-0.5 px-3 py-1 border-b border-edge/40">
      {children}
    </div>
  );
}

/** Overflow menu with sort options and optional extra sections. */
export function ViewOptionsMenu({
  sortOrder,
  onSortOrderChange,
  displayMode,
  onDisplayModeChange,
  onExpandAll,
  onCollapseAll,
}: {
  sortOrder: FileSortOrder;
  onSortOrderChange: (order: FileSortOrder) => void;
  displayMode?: ChangesDisplayMode;
  onDisplayModeChange?: (mode: ChangesDisplayMode) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
}): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(["name", "size", "modified"] as const).map((order) => (
          <DropdownMenuItem
            key={order}
            onClick={() => onSortOrderChange(order)}
          >
            <span className="flex-1">{SORT_LABELS[order]}</span>
            {sortOrder === order && SELECTED_CHECK}
          </DropdownMenuItem>
        ))}
        {onDisplayModeChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDisplayModeChange("tree")}>
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M3 3h10M5 6h8M7 9h6M5 12h8" />
              </svg>
              <span className="flex-1">Tree view</span>
              {displayMode === "tree" && SELECTED_CHECK}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDisplayModeChange("flat")}>
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M3 3h10M3 6h10M3 9h10M3 12h10" />
              </svg>
              <span className="flex-1">Flat view</span>
              {displayMode === "flat" && SELECTED_CHECK}
            </DropdownMenuItem>
          </>
        )}
        {(onExpandAll || onCollapseAll) && (
          <>
            <DropdownMenuSeparator />
            {onExpandAll && (
              <DropdownMenuItem onClick={onExpandAll}>
                Expand all
              </DropdownMenuItem>
            )}
            {onCollapseAll && (
              <DropdownMenuItem onClick={onCollapseAll}>
                Collapse all
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Thin horizontal progress bar. value is 0-1, color is a Tailwind bg class. */
export function ProgressBar({
  value,
  color,
}: {
  value: number;
  color: string;
}): ReactNode {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="flex-1 h-1.5 rounded-full bg-surface-raised overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

/** Magnifying glass button that opens content search. */
export function SearchButton({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <SimpleTooltip content="Search in files">
      <button
        onClick={onClick}
        className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>
    </SimpleTooltip>
  );
}
