import type { ReactNode } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";

/** Toolbar strip below the tab switcher -- compose children for each tab's needs. */
export function PanelToolbar({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-end gap-0.5 px-3 py-1 border-b border-edge/40">
      {children}
    </div>
  );
}

/** Overflow menu with expand/collapse all actions. */
export function ExpandCollapseButtons({
  onExpandAll,
  onCollapseAll,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
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
        <DropdownMenuItem onClick={onExpandAll}>Expand all</DropdownMenuItem>
        <DropdownMenuItem onClick={onCollapseAll}>
          Collapse all
        </DropdownMenuItem>
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
