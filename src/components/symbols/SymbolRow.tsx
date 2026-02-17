import { useState, useMemo, useCallback, memo } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import { useReviewStore } from "../../stores";
import type { SymbolDiff } from "../../types";
import {
  SymbolKindBadge,
  ChangeIndicator,
  sortSymbols,
  collectAllHunkIds,
  getHunkIdsStatus,
  type SymbolHunkStatus,
} from "../symbols";
import { useReviewData } from "../ReviewDataContext";

// --- Interactive status toggle ---

export function StatusToggle({
  status,
  onApprove,
  onUnapprove,
}: {
  status: { pending: number; total: number };
  onApprove: () => void;
  onUnapprove: () => void;
}) {
  if (status.total === 0) return null;

  const isComplete = status.pending === 0;

  return (
    <SimpleTooltip content={isComplete ? "Unapprove" : "Approve"}>
      <button
        aria-label={isComplete ? "Unapprove all hunks" : "Approve all hunks"}
        onClick={(e) => {
          e.stopPropagation();
          if (isComplete) {
            onUnapprove();
          } else {
            onApprove();
          }
        }}
        className={`flex-shrink-0 text-xxs w-4 h-4 flex items-center justify-center rounded transition-colors ${
          isComplete
            ? "text-status-approved hover:text-fg0"
            : "text-fg-faint hover:text-status-approved"
        }`}
      >
        {isComplete ? "\u2713" : "\u25CB"}
      </button>
    </SimpleTooltip>
  );
}

// --- SymbolRow ---

interface SymbolRowProps {
  symbol: SymbolDiff;
  depth: number;
  filePath: string;
  children?: (props: {
    status: SymbolHunkStatus;
    symbol: SymbolDiff;
  }) => React.ReactNode;
}

export const SymbolRow = memo(function SymbolRow({
  symbol,
  depth,
  filePath,
  children,
}: SymbolRowProps) {
  const { hunkStates, trustList, onNavigate } = useReviewData();
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);
  const [expanded, setExpanded] = useState(true);

  const allHunkIds = useMemo(() => collectAllHunkIds(symbol), [symbol]);
  const status = useMemo(
    () => getHunkIdsStatus(allHunkIds, hunkStates, trustList),
    [allHunkIds, hunkStates, trustList],
  );

  const hasChildren = symbol.children.length > 0;
  const sortedChildren = useMemo(
    () => (hasChildren ? sortSymbols(symbol.children) : []),
    [symbol.children, hasChildren],
  );

  const firstHunkId = symbol.hunkIds[0] ?? null;

  const handleClick = useCallback(() => {
    if (firstHunkId) {
      onNavigate(filePath, firstHunkId);
    } else if (hasChildren) {
      for (const child of symbol.children) {
        if (child.hunkIds.length > 0) {
          onNavigate(filePath, child.hunkIds[0]);
          return;
        }
      }
    }
  }, [firstHunkId, filePath, onNavigate, hasChildren, symbol.children]);

  const handleApprove = useCallback(
    () => approveHunkIds(allHunkIds),
    [approveHunkIds, allHunkIds],
  );

  const handleUnapprove = useCallback(
    () => unapproveHunkIds(allHunkIds),
    [unapproveHunkIds, allHunkIds],
  );

  const paddingLeft = `${depth * 0.8 + 0.5}rem`;

  return (
    <div className="select-none">
      <div
        className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-surface-raised/40 transition-colors cursor-pointer"
        style={{ paddingLeft }}
        onClick={hasChildren ? () => setExpanded(!expanded) : handleClick}
      >
        {hasChildren ? (
          <button
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <svg
              className={`h-3 w-3 flex-shrink-0 text-fg-faint transition-transform ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <ChangeIndicator changeType={symbol.changeType} />
        <SymbolKindBadge kind={symbol.kind} />
        <button
          className={`min-w-0 flex-1 truncate text-left text-xs cursor-pointer ${symbol.changeType === "removed" ? "line-through text-status-rejected/70" : symbol.changeType === "added" ? "text-status-approved" : "text-fg-secondary"}`}
          onClick={(e) => {
            e.stopPropagation();
            handleClick();
          }}
        >
          {symbol.name}
        </button>
        {children?.({ status, symbol })}
        <StatusToggle
          status={status}
          onApprove={handleApprove}
          onUnapprove={handleUnapprove}
        />
      </div>

      {expanded && sortedChildren.length > 0 && (
        <div>
          {sortedChildren.map((child) => (
            <SymbolRow
              key={`${child.changeType}-${child.name}-${child.newRange?.startLine ?? child.oldRange?.startLine ?? 0}`}
              symbol={child}
              depth={depth + 1}
              filePath={filePath}
            >
              {children}
            </SymbolRow>
          ))}
        </div>
      )}
    </div>
  );
});
