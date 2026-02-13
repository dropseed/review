import { type ReactNode, useState, useMemo, useEffect, useRef } from "react";
import { useReviewStore } from "../../stores";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import {
  anyLabelMatchesPattern,
  isHunkUnclassified,
  type TrustCategory,
} from "../../types";
import { getApiClient } from "../../api";
import { Checkbox } from "../ui/checkbox";
import { SimpleTooltip } from "../ui/tooltip";
import { playApproveSound, playBulkSound } from "../../utils/sounds";
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
  // Build a set of known pattern IDs for O(1) lookup
  const knownPatternIds = new Set<string>();
  for (const category of categories) {
    for (const pattern of category.patterns) {
      knownPatternIds.add(pattern.id);
    }
  }

  // Iterate hunks once, increment counts by label (O(hunks * labels_per_hunk))
  const counts = new Map<string, number>();
  for (const hunk of hunks) {
    const labels = hunkStates?.[hunk.id]?.label ?? [];
    for (const label of labels) {
      if (knownPatternIds.has(label)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }

  // Convert trustList to Set for O(1) membership checks
  const trustSet = new Set(trustList);

  const result: PatternInfo[] = [];
  for (const category of categories) {
    for (const pattern of category.patterns) {
      result.push({
        id: pattern.id,
        name: pattern.name,
        description: pattern.description,
        categoryId: category.id,
        categoryName: category.name,
        count: counts.get(pattern.id) ?? 0,
        trusted: trustSet.has(pattern.id),
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
          muted ? "opacity-60 hover:opacity-80" : "hover:bg-stone-800/50"
        }`}
      >
        <Checkbox
          className="h-3.5 w-3.5 shrink-0 pointer-events-none group-hover:data-[state=unchecked]:border-stone-500"
          checked={pattern.trusted}
          tabIndex={-1}
        />
        <div className="flex-1 min-w-0">
          <span
            className={`text-xs font-medium ${pattern.trusted ? "text-cyan-300" : "text-stone-300"}`}
          >
            {pattern.name}
          </span>
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

export function TrustSection(): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const addTrustPattern = useReviewStore((s) => s.addTrustPattern);
  const removeTrustPattern = useReviewStore((s) => s.removeTrustPattern);
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
  const [showZeroMatch, setShowZeroMatch] = useState(false);

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

  const knownPatternIds = useKnownPatternIds();
  const { trustedHunkCount, trustableHunkCount } =
    useTrustCounts(knownPatternIds);

  const unlabeledCount = useMemo(
    () =>
      hunks.filter((h) => isHunkUnclassified(reviewState?.hunks[h.id])).length,
    [hunks, reviewState?.hunks],
  );

  // Split patterns into visible (has matches or trusted) and zero-match hidden
  const { visiblePatterns, zeroMatchPatterns } = useMemo(() => {
    const visible: PatternInfo[] = [];
    const zeroMatch: PatternInfo[] = [];
    for (const p of patterns) {
      if (p.count > 0 || p.trusted) {
        visible.push(p);
      } else {
        zeroMatch.push(p);
      }
    }
    return { visiblePatterns: visible, zeroMatchPatterns: zeroMatch };
  }, [patterns]);

  const percent =
    trustableHunkCount > 0 ? (trustedHunkCount / trustableHunkCount) * 100 : 0;

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
  const stale = isClassificationStale();

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

  // Build a Map<patternId, pattern> for O(1) lookups by ID
  const patternById = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const category of trustCategories) {
      for (const pattern of category.patterns) {
        map.set(pattern.id, pattern);
      }
    }
    return map;
  }, [trustCategories]);

  const modalPatternName = useMemo(() => {
    if (!modalPatternId) return "";
    return patternById.get(modalPatternId)?.name ?? modalPatternId;
  }, [modalPatternId, patternById]);

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

  // Render flat pattern list with lightweight category headers
  const renderPatternList = (patternList: PatternInfo[]) => {
    const elements: ReactNode[] = [];
    let lastCategoryId = "";

    for (const pattern of patternList) {
      if (pattern.categoryId !== lastCategoryId) {
        lastCategoryId = pattern.categoryId;
        elements.push(
          <div
            key={`cat-${pattern.categoryId}`}
            className="px-3 pt-3 pb-1 text-xxs font-medium uppercase tracking-wider text-stone-600"
          >
            {pattern.categoryName}
          </div>,
        );
      }
      elements.push(
        <PatternRow
          key={pattern.id}
          pattern={pattern}
          onToggle={handleToggle}
          onExpandToggle={handleExpandToggle}
          isExpanded={expandedPatternId === pattern.id}
          previewHunks={
            expandedPatternId === pattern.id ? getPreviewHunks(pattern.id) : []
          }
          onSelectHunk={handleSelectHunk}
          onShowAllModal={handleShowAllModal}
        />,
      );
    }

    return elements;
  };

  return (
    <div className="space-y-4">
      {/* Compact inline progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500/50 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-xs text-stone-500 tabular-nums shrink-0">
          {trustedHunkCount} of {trustableHunkCount} trustable hunks
        </span>
      </div>

      {/* Error banner */}
      {classificationError && (
        <div className="rounded-md bg-rose-500/10 px-2.5 py-1.5 text-2xs text-rose-400 inset-ring-1 inset-ring-rose-500/20">
          {classificationError}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center flex-wrap gap-2">
        {classifying ? (
          <span
            className="flex items-center gap-1.5 rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50"
            aria-live="polite"
          >
            <SpinnerIcon className="h-3 w-3 animate-spin" />
            Classifying...
          </span>
        ) : stale ? (
          <button
            onClick={() => classifyUnlabeledHunks()}
            className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2.5 py-1 text-2xs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors whitespace-nowrap"
          >
            Reclassify (stale)
          </button>
        ) : unlabeledCount > 0 ? (
          <button
            onClick={() => classifyUnlabeledHunks()}
            className="rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors whitespace-nowrap"
          >
            Classify {unlabeledCount} unclassified
          </button>
        ) : allClassified ? (
          <button
            onClick={() => reclassifyHunks()}
            className="rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors whitespace-nowrap"
          >
            Reclassify
          </button>
        ) : null}
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
      </div>

      {/* Flat pattern list */}
      {trustCategories.length > 0 && (
        <div>
          {renderPatternList(visiblePatterns)}

          {zeroMatchPatterns.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowZeroMatch(!showZeroMatch)}
                className="w-full px-3 py-2 text-xxs text-stone-600 hover:text-stone-400 transition-colors text-left"
              >
                {showZeroMatch
                  ? "Hide patterns with no matches"
                  : `Show ${zeroMatchPatterns.length} more pattern${zeroMatchPatterns.length !== 1 ? "s" : ""} with no matches`}
              </button>
              {showZeroMatch && renderPatternList(zeroMatchPatterns)}
            </>
          )}
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
