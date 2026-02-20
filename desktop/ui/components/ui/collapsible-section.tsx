import { type ReactNode, useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./collapsible";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./dropdown-menu";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  badge?: number | string;
  badgeColor?: string;
  isOpen: boolean;
  onToggle: () => void;
  actionContent?: ReactNode;
  menuContent?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  badge,
  badgeColor = "bg-status-modified/20 text-status-modified",
  isOpen,
  onToggle,
  actionContent,
  menuContent,
  children,
}: CollapsibleSectionProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="border-t border-t-edge/40">
        <div className="relative group/section flex items-center">
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 items-center gap-2 pl-3 pr-2 py-2 text-left text-xs font-medium text-fg-secondary hover:bg-surface-raised/50 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-focus-ring/50">
              {icon}
              <span className="flex-1">{title}</span>
              {badge !== undefined && badge !== 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeColor}`}
                >
                  {badge}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-0.5 pr-1">
            {actionContent}
            {menuContent && (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menuContent}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <CollapsibleContent>
          <div className="pl-1">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function DisplayModeToggle({
  mode,
  onChange,
}: {
  mode: "tree" | "flat";
  onChange: (mode: "tree" | "flat") => void;
}): ReactNode {
  const nextMode = mode === "tree" ? "flat" : "tree";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange(nextMode);
      }}
      className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
      title={`Switch to ${nextMode} view`}
    >
      {mode === "tree" ? (
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 16 16"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M3 3h10M3 6h10M3 9h10M3 12h10" />
        </svg>
      ) : (
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 16 16"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M3 3h10M5 6h8M7 9h6M5 12h8" />
        </svg>
      )}
    </button>
  );
}

/** Simple menu item helper for CollapsibleSection menuContent */
export { DropdownMenuItem as CollapsibleSectionMenuItem };
export { DropdownMenuSeparator as CollapsibleSectionMenuSeparator };
