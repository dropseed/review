import {
  type MouseEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import {
  computeCommitGroups,
  countUnreviewed,
  type Group,
} from "../../stores/selectors/groups";
import { toggleScope } from "../../types/scope";
import {
  isCommitScope,
  singleCommitScope,
  commitRangeScope,
  commitSetScope,
  scopeCommitKeys,
} from "./commitScope";
import { truncateSubject } from "./commitFormat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Spinner } from "../ui/spinner";
import { SELECTED_CHECK } from "./PanelToolbar";

const CHEVRON_DOWN = (
  <svg
    className="h-3 w-3 shrink-0 text-fg-faint"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const COMMITS_ICON = (
  <svg
    className="h-3.5 w-3.5 shrink-0 text-fg-faint"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v6M12 15v6" />
  </svg>
);

function progressText(done: number, total: number): string {
  return `${done}/${total}`;
}

/**
 * The Review tab's commit scope picker: a dropdown, sitting where the old
 * grouping segmented control lived, that scopes the single Status queue to a
 * commit, a contiguous range of commits, or the uncommitted bucket — instead
 * of switching the queue's grouping entirely (see FilesPanel/index.tsx).
 * Loads commit attribution proactively, same as the grouping control it
 * replaced, so it can render (or quietly stay hidden) as soon as the
 * comparison loads.
 */
export function CommitScopePicker(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const attribution = useReviewStore((s) => s.attribution);
  const attributionLoading = useReviewStore((s) => s.attributionLoading);
  const attributionLoaded = useReviewStore((s) => s.attributionLoaded);
  const loadAttribution = useReviewStore((s) => s.loadAttribution);
  const reviewState = useReviewStore((s) => s.reviewState);
  const scope = useReviewStore((s) => s.scope);
  const setScope = useReviewStore((s) => s.setScope);
  const hunks = useAllHunks();

  useEffect(() => {
    if (repoPath && comparison && !attributionLoaded && !attributionLoading) {
      loadAttribution(repoPath, comparison.base, comparison.head);
    }
  }, [
    repoPath,
    comparison,
    attributionLoaded,
    attributionLoading,
    loadAttribution,
  ]);

  const groups = useMemo(
    () => computeCommitGroups(hunks, attribution),
    [hunks, attribution],
  );
  const commitGroups = useMemo(
    () => groups.filter((g) => g.source === "commit"),
    [groups],
  );
  const uncommittedGroup = groups.find((g) => g.source === "uncommitted");
  const ordinalByKey = useMemo(() => {
    const m = new Map<string, number>();
    commitGroups.forEach((g, i) => m.set(g.key, i + 1));
    return m;
  }, [commitGroups]);
  const selectedKeys = useMemo(() => scopeCommitKeys(scope), [scope]);

  // Per-group done/total, shared by the trigger label and every menu row so
  // neither calls countUnreviewed inline per row per render.
  const progressByKey = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const g of groups) {
      const unreviewed = countUnreviewed(g.hunkIds, reviewState);
      map.set(g.key, {
        done: g.hunkIds.length - unreviewed,
        total: g.hunkIds.length,
      });
    }
    return map;
  }, [groups, reviewState]);

  // Anchor commit for shift-click range building. Reset whenever the user
  // makes a plain-click selection; when a shift-click arrives with no local
  // anchor (e.g. the scope came from a provenance-tag click elsewhere), fall
  // back to the lower end of whatever commit scope is already active.
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const anchorOrdinal = useMemo(() => {
    if (anchorKey) {
      const o = ordinalByKey.get(anchorKey);
      if (o != null) return o;
    }
    const ordinals = [...selectedKeys]
      .map((k) => ordinalByKey.get(k))
      .filter((o): o is number => o != null);
    return ordinals.length > 0 ? Math.min(...ordinals) : null;
  }, [anchorKey, ordinalByKey, selectedKeys]);

  // Tracks which range-building modifier the click that's about to fire
  // onSelect carried, so onSelect can preventDefault() and keep the menu
  // open — set in onClick (a real MouseEvent), read in onSelect (whose event
  // is a synthetic CustomEvent with no modifier keys of its own). Shift
  // builds a contiguous range from the anchor; cmd/ctrl toggles the clicked
  // commit in/out of the current (possibly non-contiguous) selection.
  const modifierRef = useRef<{ shift: boolean; toggle: boolean }>({
    shift: false,
    toggle: false,
  });

  const handleCommitClick = (group: Group, ordinal: number) => {
    const { shift, toggle } = modifierRef.current;

    if (shift && anchorOrdinal != null) {
      const lo = Math.min(anchorOrdinal, ordinal);
      const hi = Math.max(anchorOrdinal, ordinal);
      if (lo === hi) {
        setScope(singleCommitScope(group));
        setAnchorKey(group.key);
        return;
      }
      const included = commitGroups.slice(lo - 1, hi);
      setScope(commitRangeScope(included, lo, hi));
      return; // keep the existing anchor so further shift-clicks extend from it
    }

    if (toggle) {
      const nextKeys = new Set(selectedKeys);
      if (nextKeys.has(group.key)) {
        nextKeys.delete(group.key);
      } else {
        nextKeys.add(group.key);
      }
      if (nextKeys.size === 0) {
        setScope(null);
        setAnchorKey(null);
        return;
      }
      const selected = commitGroups.filter((g) => nextKeys.has(g.key));
      setScope(
        selected.length === 1
          ? singleCommitScope(selected[0])
          : commitSetScope(selected),
      );
      setAnchorKey(group.key);
      return;
    }

    const next = toggleScope(scope, singleCommitScope(group));
    setScope(next);
    setAnchorKey(next ? group.key : null);
  };

  const handleUncommittedClick = () => {
    if (!uncommittedGroup) return;
    const next = toggleScope(scope, {
      source: uncommittedGroup.source,
      key: uncommittedGroup.key,
      title: uncommittedGroup.title,
      hunkIds: uncommittedGroup.hunkIds,
    });
    setScope(next);
    setAnchorKey(null);
  };

  const handleAllCommits = () => {
    if (isCommitScope(scope)) setScope(null);
    setAnchorKey(null);
  };

  const onItemClick = (e: MouseEvent) => {
    modifierRef.current = {
      shift: e.shiftKey,
      toggle: !e.shiftKey && (e.metaKey || e.ctrlKey),
    };
  };
  const onItemSelect = (e: Event) => {
    if (modifierRef.current.shift || modifierRef.current.toggle) {
      e.preventDefault();
    }
  };

  if (attributionLoading && !attribution) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xxs text-fg-faint border-b border-edge-default/40">
        <Spinner className="h-3 w-3 border-2 border-edge-default border-t-status-modified" />
        Loading commits…
      </div>
    );
  }

  if (!attribution || groups.length === 0) return null;

  const label = (() => {
    if (!isCommitScope(scope)) return "All commits";
    if (scope!.source === "uncommitted") {
      const unreviewed = countUnreviewed(scope!.hunkIds, reviewState);
      return `Uncommitted changes · ${progressText(scope!.hunkIds.length - unreviewed, scope!.hunkIds.length)}`;
    }
    const ordinals = [...selectedKeys]
      .map((k) => ordinalByKey.get(k))
      .filter((o): o is number => o != null)
      .sort((a, b) => a - b);
    const unreviewed = countUnreviewed(scope!.hunkIds, reviewState);
    const done = scope!.hunkIds.length - unreviewed;
    if (ordinals.length > 1) {
      return `Commits #${ordinals[0]}–#${ordinals[ordinals.length - 1]} · ${progressText(done, scope!.hunkIds.length)}`;
    }
    const ordinal = ordinals[0];
    const subject = truncateSubject(scope!.title, 28);
    return ordinal
      ? `#${ordinal} · ${subject} · ${progressText(done, scope!.hunkIds.length)}`
      : `${subject} · ${progressText(done, scope!.hunkIds.length)}`;
  })();

  return (
    <div className="px-2 py-1.5 border-b border-edge-default/40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-fg-secondary hover:bg-surface-raised/60"
          >
            {COMMITS_ICON}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {CHEVRON_DOWN}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuItem onClick={handleAllCommits}>
            <span className="flex-1">All commits</span>
            {!isCommitScope(scope) && SELECTED_CHECK}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {commitGroups.map((g, i) => {
            const ordinal = i + 1;
            const p = progressByKey.get(g.key) ?? {
              done: 0,
              total: g.hunkIds.length,
            };
            const selected = selectedKeys.has(g.key);
            return (
              <DropdownMenuItem
                key={g.key}
                onClick={(e) => {
                  onItemClick(e);
                  handleCommitClick(g, ordinal);
                }}
                onSelect={onItemSelect}
                className={selected ? "bg-focus-ring/10" : undefined}
              >
                <span className="w-6 shrink-0 text-right font-mono text-xxs text-fg-faint">
                  #{ordinal}
                </span>
                <span className="shrink-0 font-mono text-xxs text-fg-muted">
                  {g.commit?.shortHash}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {truncateSubject(g.title, 40)}
                </span>
                <span className="shrink-0 text-xxs tabular-nums text-fg-faint">
                  {progressText(p.done, p.total)}
                </span>
                {selected && SELECTED_CHECK}
              </DropdownMenuItem>
            );
          })}
          {uncommittedGroup &&
            (() => {
              const p = progressByKey.get(uncommittedGroup.key) ?? {
                done: 0,
                total: uncommittedGroup.hunkIds.length,
              };
              return (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleUncommittedClick}>
                    <span className="flex-1 italic text-fg-muted">
                      Uncommitted changes
                    </span>
                    <span className="shrink-0 text-xxs tabular-nums text-fg-faint">
                      {progressText(p.done, p.total)}
                    </span>
                    {scope?.source === "uncommitted" && SELECTED_CHECK}
                  </DropdownMenuItem>
                </>
              );
            })()}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
