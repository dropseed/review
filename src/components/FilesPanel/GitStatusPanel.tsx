import { useState } from "react";
import { useReviewStore } from "../../stores";
import type { StatusEntry } from "../../types";
import { GitStatusModal } from "../modals/GitStatusModal";
import {
  CollapsibleSection,
  CollapsibleSectionMenuItem,
} from "../ui/collapsible-section";

const STATUS_COLORS: Record<
  StatusEntry["status"],
  { letter: string; color: string }
> = {
  added: { letter: "A", color: "text-status-approved" },
  modified: { letter: "M", color: "text-status-modified" },
  deleted: { letter: "D", color: "text-status-rejected" },
  renamed: { letter: "R", color: "text-status-renamed" },
  copied: { letter: "C", color: "text-status-renamed" },
};

function StatusFileRow({
  path,
  status,
  onSelect,
  actionButton,
}: {
  path: string;
  status?: StatusEntry["status"];
  onSelect: (path: string) => void;
  actionButton?: React.ReactNode;
}) {
  const config = status ? STATUS_COLORS[status] : null;
  const filename = path.split("/").pop() ?? path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;

  return (
    <div className="group flex items-center w-full px-3 py-1 text-xs text-fg-secondary hover:bg-surface-raised/50 transition-colors">
      <button
        type="button"
        onClick={() => onSelect(path)}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
      >
        <span
          className={`w-3 text-center font-mono text-xxs font-medium shrink-0 ${config?.color ?? "text-fg-muted"}`}
        >
          {config?.letter ?? "?"}
        </span>
        <span className="truncate">
          {filename}
          {dir && <span className="text-fg-faint ml-1">{dir}</span>}
        </span>
      </button>
      {actionButton && (
        <span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
          {actionButton}
        </span>
      )}
    </div>
  );
}

function StageActionButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="flex items-center justify-center w-5 h-5 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors text-xs font-mono leading-none"
    >
      {label}
    </button>
  );
}

function GitSection({
  title,
  count,
  accentColor,
  children,
  defaultOpen = true,
  menuItems,
}: {
  title: string;
  count: number;
  accentColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  menuItems?: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <CollapsibleSection
      title={title}
      badge={count}
      badgeColor={accentColor}
      isOpen={open}
      onToggle={() => setOpen(!open)}
      showTopBorder={false}
      menuContent={
        menuItems?.length
          ? menuItems.map((item) => (
              <CollapsibleSectionMenuItem
                key={item.label}
                onClick={item.onClick}
              >
                {item.label}
              </CollapsibleSectionMenuItem>
            ))
          : undefined
      }
    >
      <div className="pb-0.5">{children}</div>
    </CollapsibleSection>
  );
}

interface GitStatusPanelProps {
  onSelectFile: (path: string) => void;
  onSelectWorkingTreeFile?: (path: string) => void;
}

export function GitStatusPanel({
  onSelectFile,
  onSelectWorkingTreeFile,
}: GitStatusPanelProps) {
  const handleSelect = onSelectWorkingTreeFile ?? onSelectFile;
  const gitStatus = useReviewStore((s) => s.gitStatus);
  const stageFile = useReviewStore((s) => s.stageFile);
  const unstageFile = useReviewStore((s) => s.unstageFile);
  const stageAll = useReviewStore((s) => s.stageAll);
  const unstageAll = useReviewStore((s) => s.unstageAll);
  const [showModal, setShowModal] = useState(false);

  if (!gitStatus) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <p className="text-xs text-fg-muted">No git status available</p>
      </div>
    );
  }

  const { staged, unstaged, untracked } = gitStatus;
  const hasAny =
    staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <svg
          className="h-8 w-8 text-surface-hover mb-2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-xs text-fg-muted">No working tree changes</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {/* Status summary header */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left border-b border-edge/50 hover:bg-surface-raised/50 transition-colors"
      >
        <span className="text-xs text-fg-muted flex-1">
          {staged.length > 0 && (
            <span className="text-status-approved font-medium tabular-nums">
              {staged.length} staged
            </span>
          )}
          {staged.length > 0 && unstaged.length > 0 && (
            <span className="text-fg-faint mx-1">·</span>
          )}
          {unstaged.length > 0 && (
            <span className="text-status-modified font-medium tabular-nums">
              {unstaged.length} unstaged
            </span>
          )}
          {(staged.length > 0 || unstaged.length > 0) &&
            untracked.length > 0 && (
              <span className="text-fg-faint mx-1">·</span>
            )}
          {untracked.length > 0 && (
            <span className="text-fg-muted font-medium tabular-nums">
              {untracked.length} untracked
            </span>
          )}
        </span>
        <span className="text-fg-faint text-xxs">git status</span>
      </button>

      <GitStatusModal isOpen={showModal} onClose={() => setShowModal(false)} />

      {staged.length > 0 && (
        <GitSection
          title="Staged"
          count={staged.length}
          accentColor="bg-status-approved/20 text-status-approved"
          menuItems={[{ label: "Unstage all", onClick: () => unstageAll() }]}
        >
          {staged.map((entry) => (
            <StatusFileRow
              key={entry.path}
              path={entry.path}
              status={entry.status}
              onSelect={handleSelect}
              actionButton={
                <StageActionButton
                  label="−"
                  title="Unstage"
                  onClick={() => unstageFile(entry.path)}
                />
              }
            />
          ))}
        </GitSection>
      )}

      {unstaged.length > 0 && (
        <GitSection
          title="Unstaged"
          count={unstaged.length}
          accentColor="bg-status-modified/20 text-status-modified"
          menuItems={[{ label: "Stage all", onClick: () => stageAll() }]}
        >
          {unstaged.map((entry) => (
            <StatusFileRow
              key={entry.path}
              path={entry.path}
              status={entry.status}
              onSelect={handleSelect}
              actionButton={
                <StageActionButton
                  label="+"
                  title="Stage"
                  onClick={() => stageFile(entry.path)}
                />
              }
            />
          ))}
        </GitSection>
      )}

      {untracked.length > 0 && (
        <GitSection
          title="Untracked"
          count={untracked.length}
          accentColor="bg-fg-muted/20 text-fg-muted"
        >
          {untracked.map((path) => (
            <StatusFileRow
              key={path}
              path={path}
              onSelect={onSelectFile}
              actionButton={
                <StageActionButton
                  label="+"
                  title="Stage"
                  onClick={() => stageFile(path)}
                />
              }
            />
          ))}
        </GitSection>
      )}
    </div>
  );
}
