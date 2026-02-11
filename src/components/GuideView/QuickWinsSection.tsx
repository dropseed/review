import { type ReactNode, useState, useMemo, useEffect, useRef } from "react";
import { useReviewStore } from "../../stores";
import { useTrustCounts } from "../../hooks/useTrustCounts";
import { anyLabelMatchesPattern, type TrustCategory } from "../../types";
import { getApiClient } from "../../api";
import { Checkbox } from "../ui/checkbox";
import { SimpleTooltip } from "../ui/tooltip";
import { playApproveSound, playBulkSound } from "../../utils/sounds";
import { useAnimatedCount } from "../../hooks/useAnimatedCount";
import {
  HunkPreviewModal,
  InlineHunkPreviewList,
  type PreviewHunk,
} from "./HunkPreviewPanel";

interface PatternInfo {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  count: number;
  trusted: boolean;
}

function buildPatternList(
  categories: TrustCategory[],
  hunks: { id: string }[],
  hunkStates: Record<string, { label?: string[] }> | undefined,
  trustList: string[],
): PatternInfo[] {
  const counts: Record<string, number> = {};
  for (const hunk of hunks) {
    const labels = hunkStates?.[hunk.id]?.label ?? [];
    for (const category of categories) {
      for (const pattern of category.patterns) {
        if (anyLabelMatchesPattern(labels, pattern.id)) {
          counts[pattern.id] = (counts[pattern.id] ?? 0) + 1;
        }
      }
    }
  }

  const result: PatternInfo[] = [];
  for (const category of categories) {
    for (const pattern of category.patterns) {
      const count = counts[pattern.id] ?? 0;
      result.push({
        id: pattern.id,
        name: pattern.name,
        description: pattern.description,
        categoryId: category.id,
        categoryName: category.name,
        count,
        trusted: trustList.includes(pattern.id),
      });
    }
  }

  return result;
}

function getCountBadgeClassName(
  isExpanded: boolean,
  isTrusted: boolean,
  hasCount: boolean,
): string {
  const base =
    "font-mono text-xs tabular-nums shrink-0 rounded px-1 py-px transition-colors";
  if (isExpanded) {
    return `${base} bg-stone-600 text-stone-200`;
  }
  if (!hasCount) {
    return `${base} text-stone-700`;
  }
  if (isTrusted) {
    return `${base} text-cyan-400 hover:bg-cyan-500/15 hover:text-cyan-300`;
  }
  return `${base} text-stone-500 hover:bg-stone-700 hover:text-stone-400`;
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

interface PatternRowProps {
  pattern: PatternInfo;
  onToggle: (id: string, trusted: boolean) => void;
  onExpandToggle: (id: string) => void;
  isExpanded: boolean;
  previewHunks: PreviewHunk[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
  onShowAllModal: (patternId: string) => void;
}

function PatternRow({
  pattern,
  onToggle,
  onExpandToggle,
  isExpanded,
  previewHunks,
  onSelectHunk,
  onShowAllModal,
}: PatternRowProps) {
  const muted = pattern.count === 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(pattern.id, !pattern.trusted)}
        className={`group flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${
          pattern.trusted
            ? "bg-cyan-500/8 hover:bg-cyan-500/12"
            : muted
              ? "opacity-40 hover:opacity-60"
              : "hover:bg-stone-800/50"
        }`}
      >
        <Checkbox
          className="h-3.5 w-3.5 shrink-0 pointer-events-none group-hover:data-[state=unchecked]:border-stone-500"
          checked={pattern.trusted}
          tabIndex={-1}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium ${pattern.trusted ? "text-cyan-300" : "text-stone-300"}`}
            >
              {pattern.name}
            </span>
            {!pattern.trusted && pattern.count > 0 && (
              <span className="text-xxs text-stone-600 italic">
                Would auto-approve {pattern.count} hunk
                {pattern.count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xxs text-stone-500 truncate">
            {pattern.description}
          </p>
        </div>
        {pattern.count > 0 && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onExpandToggle(pattern.id);
            }}
            className={getCountBadgeClassName(
              isExpanded,
              pattern.trusted,
              true,
            )}
          >
            {pattern.count}
          </span>
        )}
        {pattern.count === 0 && (
          <span className={getCountBadgeClassName(false, false, false)}>0</span>
        )}
      </button>

      {/* Inline preview */}
      {isExpanded && previewHunks.length > 0 && (
        <div className="ml-9 mr-3 mt-1 mb-2">
          <InlineHunkPreviewList
            hunks={previewHunks}
            onSelectHunk={onSelectHunk}
            onShowAll={() => onShowAllModal(pattern.id)}
          />
        </div>
      )}
    </div>
  );
}

interface CategorySectionProps {
  categoryName: string;
  patterns: PatternInfo[];
  totalMatches: number;
  onTogglePattern: (id: string, trusted: boolean) => void;
  onToggleCategory: (trusted: boolean) => void;
  allTrusted: boolean;
  someTrusted: boolean;
  expandedPatternId: string | null;
  onExpandToggle: (id: string) => void;
  getPreviewHunks: (patternId: string) => PreviewHunk[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
  onShowAllModal: (patternId: string) => void;
}

function CategorySection({
  categoryName,
  patterns,
  totalMatches,
  onTogglePattern,
  onToggleCategory,
  allTrusted,
  someTrusted,
  expandedPatternId,
  onExpandToggle,
  getPreviewHunks,
  onSelectHunk,
  onShowAllModal,
}: CategorySectionProps) {
  const [isOpen, setIsOpen] = useState(() => totalMatches > 0);
  const prevTotalMatches = useRef(totalMatches);
  useEffect(() => {
    const prev = prevTotalMatches.current;
    prevTotalMatches.current = totalMatches;
    // Auto-expand when matches appear (e.g., after classification runs)
    if (prev === 0 && totalMatches > 0) {
      setIsOpen(true);
    }
  }, [totalMatches]);

  return (
    <div>
      {/* Category header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => onToggleCategory(!allTrusted)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <Checkbox
            className="h-3.5 w-3.5 shrink-0 pointer-events-none"
            checked={allTrusted ? true : someTrusted ? "indeterminate" : false}
            tabIndex={-1}
          />
          <span className="text-xs font-medium text-stone-300">
            {categoryName}
          </span>
        </button>
        <span className="text-xxs text-stone-600 tabular-nums shrink-0">
          {totalMatches > 0
            ? `${totalMatches} hunk${totalMatches !== 1 ? "s" : ""} matched`
            : ""}
        </span>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="shrink-0 p-0.5 text-stone-600 hover:text-stone-400 transition-colors"
        >
          <svg
            className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* Pattern rows */}
      {isOpen && (
        <div className="ml-2">
          {patterns.map((pattern) => (
            <PatternRow
              key={pattern.id}
              pattern={pattern}
              onToggle={onTogglePattern}
              onExpandToggle={onExpandToggle}
              isExpanded={expandedPatternId === pattern.id}
              previewHunks={
                expandedPatternId === pattern.id
                  ? getPreviewHunks(pattern.id)
                  : []
              }
              onSelectHunk={onSelectHunk}
              onShowAllModal={onShowAllModal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function QuickWinsSection(): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const addTrustPattern = useReviewStore((s) => s.addTrustPattern);
  const removeTrustPattern = useReviewStore((s) => s.removeTrustPattern);
  const setTrustList = useReviewStore((s) => s.setTrustList);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const classifying = useReviewStore((s) => s.classifying);
  const classificationError = useReviewStore((s) => s.classificationError);
  const classifyUnlabeledHunks = useReviewStore(
    (s) => s.classifyUnlabeledHunks,
  );
  const reclassifyHunks = useReviewStore((s) => s.reclassifyHunks);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const isClassificationStale = useReviewStore((s) => s.isClassificationStale);

  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(
    null,
  );
  const [modalPatternId, setModalPatternId] = useState<string | null>(null);

  // Load taxonomy on mount
  useEffect(() => {
    getApiClient()
      .getTrustTaxonomy()
      .then(setTrustCategories)
      .catch((err) => console.error("Failed to load taxonomy:", err));
  }, []);

  const trustList = reviewState?.trustList ?? [];

  const patterns = useMemo(
    () =>
      buildPatternList(trustCategories, hunks, reviewState?.hunks, trustList),
    [trustCategories, hunks, reviewState?.hunks, trustList],
  );

  // Group patterns by category
  const categorizedPatterns = useMemo(() => {
    const map = new Map<string, PatternInfo[]>();
    for (const p of patterns) {
      const list = map.get(p.categoryId) ?? [];
      list.push(p);
      map.set(p.categoryId, list);
    }
    return map;
  }, [patterns]);

  const { trustedHunkCount } = useTrustCounts();

  const unlabeledCount = useMemo(
    () =>
      hunks.filter((h) => {
        const labels = reviewState?.hunks[h.id]?.label;
        return !labels || labels.length === 0;
      }).length,
    [hunks, reviewState?.hunks],
  );

  // Animated display count
  const displayCount = useAnimatedCount(trustedHunkCount);
  const percent =
    hunks.length > 0 ? (trustedHunkCount / hunks.length) * 100 : 0;

  // Sound effects on trust changes
  const prevCountRef = useRef(trustedHunkCount);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = trustedHunkCount;
    if (trustedHunkCount <= prev) return;
    const delta = trustedHunkCount - prev;
    if (delta >= 5) {
      playBulkSound();
    } else {
      playApproveSound();
    }
  }, [trustedHunkCount]);

  const handleToggle = (id: string, trusted: boolean) => {
    if (trusted) addTrustPattern(id);
    else removeTrustPattern(id);
  };

  const allClassified = unlabeledCount === 0;

  const getPreviewHunks = (patternId: string): PreviewHunk[] => {
    return hunks
      .filter((hunk) => {
        const labels = reviewState?.hunks[hunk.id]?.label ?? [];
        return anyLabelMatchesPattern(labels, patternId);
      })
      .map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));
  };

  const modalPreviewHunks = useMemo(() => {
    if (!modalPatternId) return [];
    return hunks
      .filter((hunk) => {
        const labels = reviewState?.hunks[hunk.id]?.label ?? [];
        return anyLabelMatchesPattern(labels, modalPatternId);
      })
      .map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));
  }, [hunks, reviewState?.hunks, modalPatternId]);

  const modalPatternName = useMemo(() => {
    if (!modalPatternId) return "";
    const allPatterns = trustCategories.flatMap((c) => c.patterns);
    return (
      allPatterns.find((p) => p.id === modalPatternId)?.name ?? modalPatternId
    );
  }, [modalPatternId, trustCategories]);

  const handleSelectHunk = (filePath: string, hunkId: string) => {
    navigateToBrowse(filePath);
    const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
    if (hunkIndex >= 0) {
      useReviewStore.setState({ focusedHunkIndex: hunkIndex });
    }
    setExpandedPatternId(null);
    setModalPatternId(null);
  };

  const handleExpandToggle = (patternId: string) => {
    setExpandedPatternId(expandedPatternId === patternId ? null : patternId);
  };

  const handleShowAllModal = (patternId: string) => {
    setExpandedPatternId(null);
    setModalPatternId(patternId);
  };

  return (
    <div className="space-y-4">
      {/* Running tally */}
      <div className="rounded-lg border border-stone-800 p-4 text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="text-3xl font-semibold tabular-nums text-cyan-400">
            {displayCount}
          </span>
          <span className="text-sm text-stone-500">
            of {hunks.length} hunks auto-approved
          </span>
        </div>
        <div className="mt-2 h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500/50 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Error banner */}
      {classificationError && (
        <div className="rounded-md bg-rose-500/10 px-2.5 py-1.5 text-2xs text-rose-400 inset-ring-1 inset-ring-rose-500/20">
          {classificationError}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center flex-wrap gap-2">
        {unlabeledCount > 0 && !classifying && (
          <button
            onClick={() => classifyUnlabeledHunks()}
            className="rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors whitespace-nowrap"
          >
            Classify {unlabeledCount} unclassified
          </button>
        )}
        {classifying && (
          <span className="flex items-center gap-1.5 rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50">
            <SpinnerIcon className="h-3 w-3 animate-spin" />
            Classifying...
          </span>
        )}
        {allClassified && !classifying && (
          <button
            onClick={() => reclassifyHunks()}
            className="rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors whitespace-nowrap"
          >
            Reclassify
          </button>
        )}
        <div className="flex-1" />
        {!claudeAvailable && (
          <SimpleTooltip content="Claude CLI not found. Install it to enable AI classification.">
            <span className="text-stone-600">
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </span>
          </SimpleTooltip>
        )}
        {isClassificationStale() && !classifying && (
          <button
            onClick={() => classifyUnlabeledHunks()}
            className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xxs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors"
          >
            Reclassify
          </button>
        )}
      </div>

      {/* Category-grouped pattern list */}
      {trustCategories.length > 0 && (
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-800">
            <h3 className="text-xs font-medium text-stone-400">
              Trust patterns
            </h3>
          </div>
          <div className="divide-y divide-stone-800/50 p-1">
            {trustCategories.map((category) => {
              const catPatterns = categorizedPatterns.get(category.id) ?? [];
              const totalMatches = catPatterns.reduce(
                (sum, p) => sum + p.count,
                0,
              );
              const trustedInCategory = catPatterns.filter(
                (p) => p.trusted,
              ).length;
              const allTrusted =
                catPatterns.length > 0 &&
                trustedInCategory === catPatterns.length;
              const someTrusted = trustedInCategory > 0 && !allTrusted;

              const handleToggleCategory = (trusted: boolean) => {
                const ids = catPatterns.map((p) => p.id);
                if (trusted) {
                  // Trust all in category
                  const newList = [...new Set([...trustList, ...ids])];
                  setTrustList(newList);
                } else {
                  // Untrust all in category
                  const idsSet = new Set(ids);
                  setTrustList(trustList.filter((id) => !idsSet.has(id)));
                }
              };

              return (
                <CategorySection
                  key={category.id}
                  categoryName={category.name}
                  patterns={catPatterns}
                  totalMatches={totalMatches}
                  onTogglePattern={handleToggle}
                  onToggleCategory={handleToggleCategory}
                  allTrusted={allTrusted}
                  someTrusted={someTrusted}
                  expandedPatternId={expandedPatternId}
                  onExpandToggle={handleExpandToggle}
                  getPreviewHunks={getPreviewHunks}
                  onSelectHunk={handleSelectHunk}
                  onShowAllModal={handleShowAllModal}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {trustCategories.length === 0 && !classifying && unlabeledCount === 0 && (
        <div className="rounded-lg border border-dashed border-stone-700 p-8 text-center">
          <p className="text-xs text-stone-500">
            No classified patterns found. All hunks may need manual review.
          </p>
        </div>
      )}

      {/* Next step CTA */}
      {allClassified && !classifying && trustedHunkCount > 0 && (
        <TrustNextStepCta count={trustedHunkCount} />
      )}

      {/* Hunk preview modal */}
      {modalPatternId && modalPreviewHunks.length > 0 && (
        <HunkPreviewModal
          patternName={modalPatternName}
          hunks={modalPreviewHunks}
          onSelectHunk={handleSelectHunk}
          onClose={() => setModalPatternId(null)}
        />
      )}
    </div>
  );
}

function TrustNextStepCta({ count }: { count: number }) {
  const setActiveTab = useReviewStore((s) => s.setGuideActiveTab);
  return (
    <button
      type="button"
      onClick={() => setActiveTab("focused-review")}
      className="group flex items-center gap-2 w-full rounded-lg border border-stone-700/50 px-4 py-3 text-left hover:border-stone-600 hover:bg-stone-800/30 transition-colors"
    >
      <span className="text-xs text-stone-400 group-hover:text-stone-300 transition-colors">
        {count} {count === 1 ? "hunk" : "hunks"} auto-approved. Continue to
        Guided Review
      </span>
      <svg
        className="w-3.5 h-3.5 text-stone-600 group-hover:text-stone-400 transition-colors ml-auto shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 7l5 5m0 0l-5 5m5-5H6"
        />
      </svg>
    </button>
  );
}
