import { type ReactNode, type MouseEvent } from "react";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "../ui/dropdown-menu";
import { SimpleTooltip } from "../ui/tooltip";
import { TreeChevron } from "../tree";

export interface GroupHeaderQuickAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "approve" | "default";
}

export interface GroupHeaderContext {
  isOpen: boolean;
  onToggle: (e: MouseEvent) => void;
  content: ReactNode;
}

export interface GroupHeaderProps {
  /** Leading marker: ordinal number, avatar, status icon, etc. */
  leading?: ReactNode;
  title: ReactNode;
  /** Muted styling for synthetic/catch-all groups ("Uncommitted", "Other changes"). */
  isPlaceholder?: boolean;
  progress: { done: number; total: number };
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** Omit to opt this group out of click-to-scope (title renders as static text). */
  onScopeClick?: () => void;
  isScoped?: boolean;
  /** Secondary expandable info below the header row (commit body, guide description). */
  context?: GroupHeaderContext;
  /** Hover-revealed icon-only action — kept compact so it never fights the
   * title for width (the thing "Approve remaining" used to do as a label). */
  quickAction?: GroupHeaderQuickAction;
  /**
   * Render `quickAction` even when the group reads as "complete"
   * (done === total). Most groups' quick action targets the *remaining*
   * work, so it correctly disappears once there's none left — but a group
   * like Reviewed is "complete" by construction (every member is, by
   * definition, done) and its quick action undoes the group itself, so it
   * must stay reachable regardless of progress.
   */
  showQuickActionWhenComplete?: boolean;
  /** Overflow "..." menu content. */
  menuContent?: ReactNode;
  /** Body shown when expanded. Omit for headers with no nested content. */
  children?: ReactNode;
}

/**
 * The one group-header shape every Review-tab queue grouping renders through
 * (status sections, commit groups, guide groups): a collapse chevron, an
 * optional click-to-scope title, a `done/total` progress badge, a
 * hover-revealed quick action, and an overflow menu. Keeping one component
 * for all three is what makes "Approve remaining" stop fighting the subject
 * for width — it's an icon behind a tooltip here, not an always-visible label.
 */
export function GroupHeader({
  leading,
  title,
  isPlaceholder = false,
  progress,
  isExpanded,
  onToggleExpanded,
  onScopeClick,
  isScoped = false,
  context,
  quickAction,
  showQuickActionWhenComplete = false,
  menuContent,
  children,
}: GroupHeaderProps): ReactNode {
  const isComplete = progress.total > 0 && progress.done === progress.total;
  const hasBody = children !== undefined;

  const titleContent = (
    <>
      {leading}
      <span
        className={`min-w-0 flex-1 truncate text-xs ${
          isPlaceholder ? "italic text-fg-muted" : "text-fg-secondary"
        }`}
      >
        {title}
      </span>
    </>
  );

  return (
    <div className="border-t border-t-edge/40">
      <div
        className={`group/header flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 transition-colors ${
          isScoped ? "bg-focus-ring/10" : "hover:bg-surface-raised/50"
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpanded}
          className="shrink-0 p-0.5"
          aria-label={isExpanded ? "Collapse" : "Expand"}
          disabled={!hasBody}
        >
          <TreeChevron expanded={isExpanded} visible={hasBody} />
        </button>

        {onScopeClick ? (
          <button
            type="button"
            onClick={onScopeClick}
            className="flex flex-1 items-center gap-2 min-w-0 text-left"
          >
            {titleContent}
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-2 min-w-0">
            {titleContent}
          </div>
        )}

        {context && (
          <button
            type="button"
            onClick={context.onToggle}
            className="shrink-0 p-0.5 text-fg-faint hover:text-fg-muted"
            aria-label={context.isOpen ? "Hide details" : "Show details"}
          >
            <TreeChevron expanded={context.isOpen} />
          </button>
        )}

        {progress.total > 0 && (
          <span
            className={`shrink-0 text-xxs tabular-nums ${
              isComplete ? "text-status-approved" : "text-fg-faint"
            }`}
          >
            {progress.done}/{progress.total}
          </span>
        )}

        {quickAction && (!isComplete || showQuickActionWhenComplete) && (
          <SimpleTooltip content={quickAction.label}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                quickAction.onClick();
              }}
              aria-label={quickAction.label}
              className={`shrink-0 flex items-center justify-center w-6 h-6 rounded opacity-0 transition-opacity group-hover/header:opacity-100 focus-visible:opacity-100 ${
                quickAction.tone === "approve"
                  ? "text-status-approved hover:bg-status-approved/15"
                  : "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised"
              }`}
            >
              {quickAction.icon}
            </button>
          </SimpleTooltip>
        )}

        {menuContent && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
                aria-label="More actions"
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
            <DropdownMenuContent align="end">{menuContent}</DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {context?.isOpen && (
        <div className="mx-2 mb-1 max-h-32 overflow-y-auto whitespace-pre-line rounded bg-surface-raised/40 px-2 py-1.5 text-xxs text-fg-muted scrollbar-thin">
          {context.content}
        </div>
      )}

      {hasBody && (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
          <CollapsibleContent>
            <div className="pb-1">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
