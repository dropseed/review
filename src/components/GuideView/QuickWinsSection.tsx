import { useState, useMemo, useEffect, useRef } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { anyLabelMatchesPattern, type TrustCategory } from "../../types";
import { Checkbox } from "../ui/checkbox";
import { SimpleTooltip } from "../ui/tooltip";
import { playApproveSound, playBulkSound } from "../../utils/sounds";
import { useAnimatedCount } from "../../hooks/useAnimatedCount";
import { HunkPreviewModal } from "./HunkPreviewPanel";

// ========================================================================
// Helpers
// ========================================================================

interface PatternInfo {
  id: string;
  name: string;
  description: string;
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
      if (count > 0) {
        result.push({
          id: pattern.id,
          name: pattern.name,
          description: pattern.description,
          categoryName: category.name,
          count,
          trusted: trustList.includes(pattern.id),
        });
      }
    }
  }

  result.sort((a, b) => b.count - a.count);
  return result;
}

// ========================================================================
// Components
// ========================================================================

interface PatternRowProps {
  pattern: PatternInfo;
  onToggle: (id: string, trusted: boolean) => void;
  onPreview: (id: string | null) => void;
  isPreviewActive: boolean;
}

function getCountBadgeClassName(
  isPreviewActive: boolean,
  isTrusted: boolean,
): string {
  const base =
    "font-mono text-xs tabular-nums shrink-0 rounded px-1 py-px transition-colors";
  if (isPreviewActive) {
    return `${base} bg-stone-600 text-stone-200`;
  }
  if (isTrusted) {
    return `${base} text-cyan-400 hover:bg-cyan-500/15 hover:text-cyan-300`;
  }
  return `${base} text-stone-500 hover:bg-stone-700 hover:text-stone-400`;
}

function PatternRow({
  pattern,
  onToggle,
  onPreview,
  isPreviewActive,
}: PatternRowProps) {
  return (
    <button
      type="button"
      onClick={() => onToggle(pattern.id, !pattern.trusted)}
      className={`group flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${
        pattern.trusted
          ? "bg-cyan-500/8 hover:bg-cyan-500/12"
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
          <span className="text-xxs text-stone-600">
            {pattern.categoryName}
          </span>
        </div>
        <p className="text-xxs text-stone-500 truncate">
          {pattern.description}
        </p>
      </div>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onPreview(isPreviewActive ? null : pattern.id);
        }}
        className={getCountBadgeClassName(isPreviewActive, pattern.trusted)}
      >
        {pattern.count}
      </span>
    </button>
  );
}

interface SpinnerIconProps {
  className?: string;
}

function SpinnerIcon({ className }: SpinnerIconProps) {
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

// ========================================================================
// Main component
// ========================================================================

export function QuickWinsSection() {
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
  const setClassificationsModalOpen = useReviewStore(
    (s) => s.setClassificationsModalOpen,
  );
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const isClassificationStale = useReviewStore((s) => s.isClassificationStale);

  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [previewPatternId, setPreviewPatternId] = useState<string | null>(null);

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

  // Count hunks that would be auto-approved by current trust list
  const trustedHunkCount = useMemo(() => {
    if (trustList.length === 0) return 0;
    return hunks.filter((hunk) => {
      const labels = reviewState?.hunks[hunk.id]?.label ?? [];
      return trustList.some((pattern) =>
        anyLabelMatchesPattern(labels, pattern),
      );
    }).length;
  }, [hunks, reviewState?.hunks, trustList]);

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

  const allPatternIds = useMemo(
    () => trustCategories.flatMap((c) => c.patterns.map((p) => p.id)),
    [trustCategories],
  );
  const trustedCount = reviewState?.trustList.length ?? 0;
  const allTrusted =
    allPatternIds.length > 0 && trustedCount === allPatternIds.length;
  const allClassified = unlabeledCount === 0;

  // Preview hunks for selected pattern
  const previewHunks = useMemo(() => {
    if (!previewPatternId) return [];
    return hunks
      .filter((hunk) => {
        const labels = reviewState?.hunks[hunk.id]?.label || [];
        return anyLabelMatchesPattern(labels, previewPatternId);
      })
      .map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));
  }, [hunks, reviewState, previewPatternId]);

  const previewPatternName = useMemo(() => {
    if (!previewPatternId) return "";
    const allPatterns = trustCategories.flatMap((c) => c.patterns);
    return (
      allPatterns.find((p) => p.id === previewPatternId)?.name ??
      previewPatternId
    );
  }, [previewPatternId, trustCategories]);

  const handleSelectHunk = (filePath: string, hunkId: string) => {
    navigateToBrowse(filePath);
    const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
    if (hunkIndex >= 0) {
      useReviewStore.setState({ focusedHunkIndex: hunkIndex });
    }
    setPreviewPatternId(null);
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
        {allPatternIds.length > 0 && (
          <button
            onClick={() =>
              allTrusted ? setTrustList([]) : setTrustList(allPatternIds)
            }
            className="rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors"
          >
            {allTrusted ? "Untrust all" : "Trust all"}
          </button>
        )}
        <div className="flex-1" />
        {!claudeAvailable && (
          <SimpleTooltip content="Claude CLI not found. Install it to enable AI classification.">
            <span className="flex items-center gap-1.5 rounded-md bg-stone-800/50 px-2.5 py-1 text-2xs text-stone-500 inset-ring-1 inset-ring-stone-700/40">
              Auto-classify unavailable
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
        <button
          onClick={() => setClassificationsModalOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          Browse
        </button>
      </div>

      {/* Pattern list */}
      {patterns.length > 0 && (
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-800">
            <h3 className="text-xs font-medium text-stone-400">
              Trust patterns
              <span className="text-stone-600 ml-1.5">sorted by impact</span>
            </h3>
          </div>
          <div className="divide-y divide-stone-800/50 p-1">
            {patterns.map((pattern) => (
              <PatternRow
                key={pattern.id}
                pattern={pattern}
                onToggle={handleToggle}
                onPreview={setPreviewPatternId}
                isPreviewActive={previewPatternId === pattern.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {patterns.length === 0 && !classifying && unlabeledCount === 0 && (
        <div className="rounded-lg border border-dashed border-stone-700 p-8 text-center">
          <p className="text-xs text-stone-500">
            No classified patterns found. All hunks may need manual review.
          </p>
        </div>
      )}

      {/* Hunk preview modal */}
      {previewPatternId && previewHunks.length > 0 && (
        <HunkPreviewModal
          patternName={previewPatternName}
          hunks={previewHunks}
          onSelectHunk={handleSelectHunk}
          onClose={() => setPreviewPatternId(null)}
        />
      )}
    </div>
  );
}
