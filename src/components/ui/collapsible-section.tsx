import { useState } from "react";
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
} from "./dropdown-menu";

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  badge?: number | string;
  badgeColor?: string;
  isOpen: boolean;
  onToggle: () => void;
  showTopBorder?: boolean;
  menuContent?: React.ReactNode;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  badge,
  badgeColor = "bg-status-modified/20 text-status-modified",
  isOpen,
  onToggle,
  showTopBorder = true,
  menuContent,
  children,
}: CollapsibleSectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div
        className={`border-b border-edge ${showTopBorder ? "border-t border-t-edge" : ""}`}
      >
        <div className="relative group/section">
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center gap-2 pl-3 pr-8 py-2 text-left text-xs font-medium text-fg-secondary hover:bg-surface-raised/50 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-focus-ring/50">
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
          {menuContent && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-all ${menuOpen ? "opacity-100" : "opacity-0 group-hover/section:opacity-100"}`}
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
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** Simple menu item helper for CollapsibleSection menuContent */
export { DropdownMenuItem as CollapsibleSectionMenuItem };
