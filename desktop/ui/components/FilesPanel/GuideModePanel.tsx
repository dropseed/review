import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks, useHunkById } from "../../stores/selectors/hunks";
import {
  computeGroupFiles,
  countGroupUnreviewed,
  countUnreviewed,
  type Group,
  type GroupFile,
} from "../../stores/selectors/groups";
import { SparkleIcon } from "../ui/icons";
import { TreeFileIcon } from "../tree";
import { FilePathLabel, splitFilePath } from "./file-path-label";
import { jumpToGroup, jumpToGroupFile } from "./jumpToGroup";
import { useGuideGroups } from "./useGuideGroups";

const BACK_ICON = (
  <svg
    className="h-3 w-3 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m15 6-6 6 6 6" />
  </svg>
);

const CHECK_ICON = (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const UNGROUPED_ICON = (
  <svg
    className="w-3 h-3 text-fg-faint/60 inline"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SMALL_CHECK_ICON = (
  <svg
    className="w-3 h-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

function formatStalenessMessage(added: number, removed: number): string {
  if (added > 0 && removed > 0) {
    return `+${added} / -${removed} hunks since the guide was built`;
  }
  if (added > 0) {
    return `+${added} new ${added === 1 ? "hunk" : "hunks"} since the guide was built`;
  }
  return `-${removed} ${removed === 1 ? "hunk" : "hunks"} since the guide was built`;
}

function itemStyle(
  isPlaceholder: boolean,
  isActive: boolean,
  isCompleted: boolean,
): string {
  const borderStyle = isPlaceholder ? "border-l-2 border-dashed" : "border-l-2";
  if (isActive) {
    return isPlaceholder
      ? `bg-fg/[0.06] text-fg-secondary ${borderStyle} border-fg-faint`
      : `bg-guide/15 text-guide ${borderStyle} border-guide`;
  }
  if (isCompleted)
    return `text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30 ${borderStyle} border-transparent`;
  return `text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30 ${borderStyle} border-transparent`;
}

/** The unreviewed-count pill, shared by section rows and their file rows. */
function UnreviewedBadge({
  count,
  isPlaceholder,
}: {
  count: number;
  isPlaceholder: boolean;
}): ReactNode {
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] rounded-full text-xxs font-medium tabular-nums shrink-0 px-1 ${
        isPlaceholder ? "bg-fg/[0.08] text-fg-muted" : "bg-guide/15 text-guide"
      }`}
    >
      {count}
    </span>
  );
}

/**
 * One file nested under a guide section. Clicking it opens that file's own
 * diff with the section still scoped, so only the section's hunks in the file
 * are expanded — as opposed to the section row, which opens the whole
 * section's rolling diff.
 *
 * `railClass` continues the active section's left rail down through its
 * files; it must be a literal Tailwind class so the compiler sees it.
 */
function GuideFileRow({
  filePath,
  unreviewedCount,
  isActive,
  isPlaceholder,
  railClass,
  onClick,
}: {
  filePath: string;
  unreviewedCount: number;
  isActive: boolean;
  isPlaceholder: boolean;
  railClass: string;
  onClick: () => void;
}): ReactNode {
  const { fileName } = splitFilePath(filePath);
  return (
    <button
      type="button"
      onClick={onClick}
      title={filePath}
      className={`group/f flex min-h-6 w-full items-center gap-1.5 border-l-2 py-1 pr-2 pl-8 text-left transition-colors ${railClass} ${
        isActive ? "bg-guide/10" : "hover:bg-surface-raised/30"
      }`}
    >
      <TreeFileIcon name={fileName} isDirectory={false} />
      <span className="flex min-w-0 flex-1">
        <FilePathLabel
          filePath={filePath}
          filenameHoverClass="group-hover/f:text-fg"
        />
      </span>
      {unreviewedCount > 0 ? (
        <UnreviewedBadge
          count={unreviewedCount}
          isPlaceholder={isPlaceholder}
        />
      ) : (
        <span className="shrink-0 text-status-approved">
          {SMALL_CHECK_ICON}
        </span>
      )}
    </button>
  );
}

function GuideModeHeader({ onBack }: { onBack: () => void }): ReactNode {
  return (
    <div className="flex items-center gap-2 border-b border-edge-default/40 px-2 py-1.5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-raised/40 hover:text-fg-secondary"
      >
        {BACK_ICON}
        Back
      </button>
      <div className="flex items-center gap-1.5 text-xs font-medium text-guide">
        <SparkleIcon />
        Review guide
      </div>
    </div>
  );
}

/**
 * Dedicated sidebar mode for an agent-authored guide, swapped in for the
 * normal commit-oriented Review-tab sidebar when the user clicks
 * {@link GuideBanner}. Shows only a back button and the guide's ordered
 * sections (number, title, unreviewed count, completion check) — no commit
 * picker, no status sections.
 *
 * Each section is a disclosure over the files its hunks live in, so the
 * panel reads as a file list reorganized by section rather than a list of
 * titles with the filenames hidden. The two rows mean different things:
 * clicking the section header routes through {@link jumpToGroup} for the
 * section's rolling diff across every file it touches; clicking a file row
 * routes through {@link jumpToGroupFile} for that one file's diff with the
 * section still scoped, so only its hunks there are open.
 *
 * A completed section auto-advances into the next unreviewed one after a
 * brief delay so the reviewer doesn't have to click through manually.
 */
export function GuideModePanel(): ReactNode {
  const setGuideMode = useReviewStore((s) => s.setGuideMode);
  const reviewState = useReviewStore((s) => s.reviewState);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const scopeKey = useReviewStore((s) =>
    s.scope?.source === "guide" ? s.scope.key : null,
  );
  const groupModeKey = useReviewStore((s) =>
    s.guideContentMode === "group"
      ? (s.getActiveGroupingEntry().reviewGroups[s.activeGroupIndex]?.title ??
        null)
      : null,
  );
  const getGroupingStaleness = useReviewStore((s) => s.getGroupingStaleness);
  const hunks = useAllHunks();
  const hunkById = useHunkById();
  const groups = useGuideGroups();

  const staleness = useMemo(
    () => getGroupingStaleness(),
    // `getGroupingStaleness` reads live store state, so the two extra entries
    // are what tell this memo the answer may have changed. Removing them
    // freezes staleness at whatever it was on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getGroupingStaleness, hunks, reviewState?.guide?.state],
  );

  const unreviewedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups)
      counts.set(g.key, countGroupUnreviewed(g, reviewState));
    return counts;
  }, [groups, reviewState]);

  const totalUnreviewed = useMemo(() => {
    let n = 0;
    for (const c of unreviewedCounts.values()) n += c;
    return n;
  }, [unreviewedCounts]);

  const filesByGroup = useMemo(() => {
    const map = new Map<string, GroupFile[]>();
    for (const g of groups)
      map.set(g.key, computeGroupFiles(g.hunkIds, hunkById));
    return map;
  }, [groups, hunkById]);

  // Disclosure state is an override layer over "the active section is open":
  // a 12-section guide shouldn't unfold into a wall of filenames, but once
  // the reviewer opens (or closes) a section by hand that choice sticks for
  // as long as the panel is mounted, even as the active section moves on.
  const [expandOverrides, setExpandOverrides] = useState<
    Record<string, boolean>
  >({});

  const toggleExpanded = useCallback((key: string, isExpanded: boolean) => {
    setExpandOverrides((prev) => ({ ...prev, [key]: !isExpanded }));
  }, []);

  // Drilling into a file leaves guide content mode for the plain file viewer,
  // so the store alone can no longer say which section the reviewer is in.
  // Remember the drill-down, and trust it only while the store still matches
  // it — anything else that moves the file viewer (search, symbol jumps)
  // invalidates it rather than leaving a section falsely marked active.
  const [drilledFile, setDrilledFile] = useState<{
    groupKey: string;
    filePath: string;
  } | null>(null);

  const activeDrill =
    drilledFile !== null &&
    guideContentMode === null &&
    scopeKey === drilledFile.groupKey &&
    selectedFile === drilledFile.filePath
      ? drilledFile
      : null;

  // The section the reviewer is in, via either route: its rolling diff or one
  // of its files. Both keep it highlighted, expanded, and auto-advancing.
  const activeGroupKey = groupModeKey ?? activeDrill?.groupKey ?? null;
  const activeFilePath = activeDrill?.filePath ?? null;

  // Suppress auto-advance immediately after the user clicks a section, so
  // their explicit selection isn't overridden by the effect below.
  const userNavigatedRef = useRef(false);

  // Auto-advance to the next unreviewed section when the current one completes.
  useEffect(() => {
    if (userNavigatedRef.current) {
      userNavigatedRef.current = false;
      return;
    }
    if (activeGroupKey === null || groups.length === 0) return;
    const currentIndex = groups.findIndex((g) => g.key === activeGroupKey);
    if (currentIndex === -1) return;
    if ((unreviewedCounts.get(groups[currentIndex].key) ?? 0) > 0) return;
    const nextGroup = groups.find(
      (g, i) => i > currentIndex && (unreviewedCounts.get(g.key) ?? 0) > 0,
    );
    if (nextGroup) {
      const timer = setTimeout(() => jumpToGroup(nextGroup), 300);
      return () => clearTimeout(timer);
    }
  }, [unreviewedCounts, activeGroupKey, groups]);

  const handleGroupClick = useCallback(
    (group: Group) => {
      // Only suppress the immediate auto-advance when re-opening an already
      // finished section; clicking an unreviewed section needs no guard, and
      // setting it there could strand a stale `true` that eats a later advance.
      userNavigatedRef.current = (unreviewedCounts.get(group.key) ?? 0) === 0;
      jumpToGroup(group);
    },
    [unreviewedCounts],
  );

  const handleFileClick = useCallback(
    (group: Group, filePath: string) => {
      // Same auto-advance guard as a section click: re-opening a finished
      // section must not be immediately overridden by the advance effect.
      userNavigatedRef.current = (unreviewedCounts.get(group.key) ?? 0) === 0;
      setDrilledFile({ groupKey: group.key, filePath });
      jumpToGroupFile(group, filePath);
    },
    [unreviewedCounts],
  );

  const handleBack = useCallback(() => setGuideMode(false), [setGuideMode]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <GuideModeHeader onBack={handleBack} />
        <div className="flex flex-1 items-center justify-center px-3 py-6 text-center">
          <p className="text-xs text-fg-muted">No guide sections available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <GuideModeHeader onBack={handleBack} />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {staleness.stale && (
          <div className="px-3 pt-1.5 pb-1">
            <span className="text-xxs text-fg-faint">
              {formatStalenessMessage(staleness.added, staleness.removed)}
            </span>
          </div>
        )}

        {groups.map((group, i) => {
          const unreviewedCount = unreviewedCounts.get(group.key) ?? 0;
          const isCompleted = unreviewedCount === 0;
          const isActive =
            activeGroupKey !== null && group.key === activeGroupKey;
          const files = filesByGroup.get(group.key) ?? [];
          const isExpanded = expandOverrides[group.key] ?? isActive;
          return (
            <div key={group.key}>
              <div
                className={`flex items-start gap-1.5 w-full pl-1 pr-2 py-2 text-xs transition-colors ${itemStyle(
                  !!group.isPlaceholder,
                  isActive,
                  isCompleted,
                )}`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(group.key, isExpanded)}
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded
                      ? `Collapse files in ${group.title}`
                      : `Expand files in ${group.title}`
                  }
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-faint hover:text-fg-secondary"
                >
                  <svg
                    className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M10 6l6 6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleGroupClick(group)}
                  className="flex flex-1 items-start gap-2 min-w-0 text-left"
                >
                  {isCompleted ? (
                    <span className="text-status-approved shrink-0 mt-0.5">
                      {CHECK_ICON}
                    </span>
                  ) : group.isPlaceholder ? (
                    <span className="w-4 text-center shrink-0 mt-px">
                      {UNGROUPED_ICON}
                    </span>
                  ) : (
                    <span className="w-4 text-center text-xxs text-fg-faint/60 shrink-0 tabular-nums mt-0.5">
                      {i + 1}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 line-clamp-2">
                    {group.title}
                  </span>
                  {!isCompleted && (
                    <UnreviewedBadge
                      count={unreviewedCount}
                      isPlaceholder={!!group.isPlaceholder}
                    />
                  )}
                </button>
              </div>

              {isExpanded &&
                files.map((file) => (
                  <GuideFileRow
                    key={file.filePath}
                    filePath={file.filePath}
                    unreviewedCount={countUnreviewed(
                      file.hunks.map((h) => h.id),
                      reviewState,
                    )}
                    isActive={isActive && file.filePath === activeFilePath}
                    isPlaceholder={!!group.isPlaceholder}
                    railClass={
                      isActive && !group.isPlaceholder
                        ? "border-guide/30"
                        : "border-transparent"
                    }
                    onClick={() => handleFileClick(group, file.filePath)}
                  />
                ))}
            </div>
          );
        })}

        {totalUnreviewed === 0 && (
          <div className="px-3 py-2 border-t border-edge/50">
            <span className="text-xxs text-status-approved font-medium">
              All groups reviewed
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
