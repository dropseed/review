import { type ReactNode, useState, useMemo, useCallback } from "react";
import { useReviewStore } from "../../stores";
import type { StatusEntry } from "../../types";
import {
  CollapsibleSection,
  CollapsibleSectionMenuItem,
  CollapsibleSectionMenuSeparator,
  DisplayModeToggle,
} from "../ui/collapsible-section";
import { FileNode } from "./FileNode";
import { FlatFileNode } from "./FlatFileNode";
import {
  buildFileTreeFromPaths,
  processTree,
  EMPTY_HUNK_STATUS,
} from "./FileTree.utils";
import { useFilesPanelContext } from "./FilesPanelContext";
import { PanelToolbar, ProgressBar } from "./PanelToolbar";

const STAGED_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-added"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const UNSTAGED_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-modified"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const UNTRACKED_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-info"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

function GitSection({
  title,
  icon,
  count,
  accentColor,
  children,
  defaultOpen = true,
  menuItems,
  onExpandAll,
  onCollapseAll,
}: {
  title: string;
  icon?: ReactNode;
  count: number;
  accentColor: string;
  children: ReactNode;
  defaultOpen?: boolean;
  menuItems?: { label: string; onClick: () => void }[];
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const hasExpandCollapse = onExpandAll || onCollapseAll;

  return (
    <CollapsibleSection
      title={title}
      icon={icon}
      badge={count}
      badgeColor={accentColor}
      isOpen={open}
      onToggle={() => setOpen(!open)}
      menuContent={
        (menuItems && menuItems.length > 0) || hasExpandCollapse ? (
          <>
            {menuItems?.map((item) => (
              <CollapsibleSectionMenuItem
                key={item.label}
                onClick={item.onClick}
              >
                {item.label}
              </CollapsibleSectionMenuItem>
            ))}
            {menuItems && menuItems.length > 0 && hasExpandCollapse && (
              <CollapsibleSectionMenuSeparator />
            )}
            {onExpandAll && (
              <CollapsibleSectionMenuItem onClick={onExpandAll}>
                Expand all
              </CollapsibleSectionMenuItem>
            )}
            {onCollapseAll && (
              <CollapsibleSectionMenuItem onClick={onCollapseAll}>
                Collapse all
              </CollapsibleSectionMenuItem>
            )}
          </>
        ) : undefined
      }
    >
      <div className="pb-0.5">{children}</div>
    </CollapsibleSection>
  );
}

interface GitStatusPanelProps {
  onSelectFile: (path: string) => void;
  onSelectWorkingTreeFile?: (
    path: string,
    mode?: "staged" | "unstaged",
  ) => void;
}

export function GitStatusPanel({
  onSelectFile,
  onSelectWorkingTreeFile,
}: GitStatusPanelProps): ReactNode {
  const handleSelectStaged = useCallback(
    (path: string) => {
      if (onSelectWorkingTreeFile) {
        onSelectWorkingTreeFile(path, "staged");
      } else {
        onSelectFile(path);
      }
    },
    [onSelectFile, onSelectWorkingTreeFile],
  );
  const handleSelectUnstaged = useCallback(
    (path: string) => {
      if (onSelectWorkingTreeFile) {
        onSelectWorkingTreeFile(path, "unstaged");
      } else {
        onSelectFile(path);
      }
    },
    [onSelectFile, onSelectWorkingTreeFile],
  );
  const gitStatus = useReviewStore((s) => s.gitStatus);
  const stageFile = useReviewStore((s) => s.stageFile);
  const unstageFile = useReviewStore((s) => s.unstageFile);
  const stageAll = useReviewStore((s) => s.stageAll);
  const unstageAll = useReviewStore((s) => s.unstageAll);
  const gitDisplayMode = useReviewStore((s) => s.gitDisplayMode);
  const setGitDisplayMode = useReviewStore((s) => s.setGitDisplayMode);

  const {
    togglePath,
    selectedFile,
    repoPath,
    revealLabel,
    registerRef,
    expandAll,
    collapseAll,
  } = useFilesPanelContext();

  const emptyHunkStatusMap = useMemo(() => new Map(), []);

  const stagedTree = useMemo(() => {
    if (!gitStatus || gitStatus.staged.length === 0) return [];
    const fileEntries = buildFileTreeFromPaths(
      gitStatus.staged.map((e) => ({ path: e.path, status: e.status })),
    );
    return processTree(fileEntries, emptyHunkStatusMap, "changes");
  }, [gitStatus, emptyHunkStatusMap]);

  const unstagedTree = useMemo(() => {
    if (!gitStatus || gitStatus.unstaged.length === 0) return [];
    const fileEntries = buildFileTreeFromPaths(
      gitStatus.unstaged.map((e) => ({ path: e.path, status: e.status })),
    );
    return processTree(fileEntries, emptyHunkStatusMap, "changes");
  }, [gitStatus, emptyHunkStatusMap]);

  const untrackedTree = useMemo(() => {
    if (!gitStatus || gitStatus.untracked.length === 0) return [];
    const fileEntries = buildFileTreeFromPaths(
      gitStatus.untracked.map((p) => ({ path: p })),
    );
    return processTree(fileEntries, emptyHunkStatusMap, "changes");
  }, [gitStatus, emptyHunkStatusMap]);

  const handleStageFile = useCallback(
    (path: string) => stageFile(path),
    [stageFile],
  );

  const handleUnstageFile = useCallback(
    (path: string) => unstageFile(path),
    [unstageFile],
  );

  const stagedFlat = useMemo(
    () => gitStatus?.staged ?? [],
    [gitStatus?.staged],
  );
  const unstagedFlat = useMemo(
    () => gitStatus?.unstaged ?? [],
    [gitStatus?.unstaged],
  );
  const untrackedFlat = useMemo(
    () =>
      gitStatus?.untracked.map((p) => ({
        path: p,
        status: undefined as StatusEntry["status"] | undefined,
      })) ?? [],
    [gitStatus?.untracked],
  );

  // Per-section dir paths for expand/collapse
  const collectDirPaths = useCallback(
    (entries: ReturnType<typeof processTree>) => {
      const paths = new Set<string>();
      function walk(items: typeof entries) {
        for (const entry of items) {
          if (entry.isDirectory) {
            for (const p of entry.compactedPaths) paths.add(p);
            if (entry.children) walk(entry.children);
          }
        }
      }
      walk(entries);
      return paths;
    },
    [],
  );
  const stagedDirPaths = useMemo(
    () => collectDirPaths(stagedTree),
    [collectDirPaths, stagedTree],
  );
  const unstagedDirPaths = useMemo(
    () => collectDirPaths(unstagedTree),
    [collectDirPaths, unstagedTree],
  );
  const untrackedDirPaths = useMemo(
    () => collectDirPaths(untrackedTree),
    [collectDirPaths, untrackedTree],
  );

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

  const totalFiles = staged.length + unstaged.length + untracked.length;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <PanelToolbar>
        <ProgressBar
          value={totalFiles > 0 ? staged.length / totalFiles : 0}
          color="bg-status-added"
        />
        <DisplayModeToggle mode={gitDisplayMode} onChange={setGitDisplayMode} />
      </PanelToolbar>

      {staged.length > 0 && (
        <GitSection
          title="Staged"
          icon={STAGED_ICON}
          count={staged.length}
          accentColor="bg-status-added/20 text-status-added"
          menuItems={[
            {
              label: "Approve all staged",
              onClick: () => alert("Approve all staged — coming soon"),
            },
            { label: "Unstage all", onClick: () => unstageAll() },
            {
              label: "Unstage rejected",
              onClick: () => alert("Unstage rejected — coming soon"),
            },
          ]}
          onExpandAll={
            gitDisplayMode === "tree"
              ? () => expandAll(stagedDirPaths)
              : undefined
          }
          onCollapseAll={gitDisplayMode === "tree" ? collapseAll : undefined}
        >
          {gitDisplayMode === "tree"
            ? stagedTree.map((entry) => (
                <FileNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onToggle={togglePath}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectStaged}
                  repoPath={repoPath}
                  revealLabel={revealLabel}
                  registerRef={registerRef}
                  hunkContext="all"
                  onUnstage={handleUnstageFile}
                />
              ))
            : stagedFlat.map((entry) => (
                <FlatFileNode
                  key={entry.path}
                  filePath={entry.path}
                  fileStatus={entry.status}
                  hunkStatus={EMPTY_HUNK_STATUS}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectStaged}
                  hunkContext="all"
                  onUnstage={handleUnstageFile}
                />
              ))}
        </GitSection>
      )}

      {unstaged.length > 0 && (
        <GitSection
          title="Unstaged"
          icon={UNSTAGED_ICON}
          count={unstaged.length}
          accentColor="bg-status-modified/20 text-status-modified"
          menuItems={[
            {
              label: "Stage reviewed",
              onClick: () => alert("Stage reviewed — coming soon"),
            },
            { label: "Stage all", onClick: () => stageAll() },
          ]}
          onExpandAll={
            gitDisplayMode === "tree"
              ? () => expandAll(unstagedDirPaths)
              : undefined
          }
          onCollapseAll={gitDisplayMode === "tree" ? collapseAll : undefined}
        >
          {gitDisplayMode === "tree"
            ? unstagedTree.map((entry) => (
                <FileNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onToggle={togglePath}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectUnstaged}
                  repoPath={repoPath}
                  revealLabel={revealLabel}
                  registerRef={registerRef}
                  hunkContext="all"
                  onStage={handleStageFile}
                />
              ))
            : unstagedFlat.map((entry) => (
                <FlatFileNode
                  key={entry.path}
                  filePath={entry.path}
                  fileStatus={entry.status}
                  hunkStatus={EMPTY_HUNK_STATUS}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectUnstaged}
                  hunkContext="all"
                  onStage={handleStageFile}
                />
              ))}
        </GitSection>
      )}

      {untracked.length > 0 && (
        <GitSection
          title="Untracked"
          icon={UNTRACKED_ICON}
          count={untracked.length}
          accentColor="bg-fg-muted/20 text-fg-muted"
          menuItems={[{ label: "Stage all", onClick: () => stageAll() }]}
          onExpandAll={
            gitDisplayMode === "tree"
              ? () => expandAll(untrackedDirPaths)
              : undefined
          }
          onCollapseAll={gitDisplayMode === "tree" ? collapseAll : undefined}
        >
          {gitDisplayMode === "tree"
            ? untrackedTree.map((entry) => (
                <FileNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onToggle={togglePath}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  repoPath={repoPath}
                  revealLabel={revealLabel}
                  registerRef={registerRef}
                  hunkContext="all"
                  onStage={handleStageFile}
                />
              ))
            : untrackedFlat.map((entry) => (
                <FlatFileNode
                  key={entry.path}
                  filePath={entry.path}
                  fileStatus={entry.status}
                  hunkStatus={EMPTY_HUNK_STATUS}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  hunkContext="all"
                  onStage={handleStageFile}
                />
              ))}
        </GitSection>
      )}
    </div>
  );
}
