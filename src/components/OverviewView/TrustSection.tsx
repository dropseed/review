import { useState, useMemo, useEffect } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { anyLabelMatchesPattern, type TrustCategory } from "../../types";
import { Checkbox } from "../ui/checkbox";
import { SimpleTooltip } from "../ui/tooltip";
import { HunkPreviewModal } from "./HunkPreviewPanel";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
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

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function TrustSection() {
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
  const autoClassifyEnabled = useReviewStore((s) => s.autoClassifyEnabled);
  const setAutoClassifyEnabled = useReviewStore(
    (s) => s.setAutoClassifyEnabled,
  );
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);

  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const [previewPatternId, setPreviewPatternId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Load taxonomy on mount
  useEffect(() => {
    const loadTaxonomy = async () => {
      setTaxonomyLoading(true);
      try {
        const categories = await getApiClient().getTrustTaxonomy();
        setTrustCategories(categories);
      } catch (err) {
        console.error("Failed to load taxonomy:", err);
      } finally {
        setTaxonomyLoading(false);
      }
    };
    loadTaxonomy();
  }, []);

  // Count hunks matching each pattern
  const patternCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of trustCategories) {
      for (const pattern of category.patterns) {
        counts[pattern.id] = 0;
      }
    }
    for (const hunk of hunks) {
      const hunkState = reviewState?.hunks[hunk.id];
      const labels = hunkState?.label || [];
      for (const category of trustCategories) {
        for (const pattern of category.patterns) {
          if (anyLabelMatchesPattern(labels, pattern.id)) {
            counts[pattern.id]++;
          }
        }
      }
    }
    return counts;
  }, [hunks, reviewState, trustCategories]);

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
    for (const category of trustCategories) {
      const pattern = category.patterns.find((p) => p.id === previewPatternId);
      if (pattern) return pattern.name;
    }
    return previewPatternId;
  }, [previewPatternId, trustCategories]);

  const unlabeledCount = useMemo(() => {
    return hunks.filter((hunk) => {
      const state = reviewState?.hunks[hunk.id];
      return !state?.label || state.label.length === 0;
    }).length;
  }, [hunks, reviewState]);

  const trustedCount = reviewState?.trustList.length ?? 0;
  const totalPatterns = trustCategories.reduce(
    (sum, c) => sum + c.patterns.length,
    0,
  );

  // Count how many hunks are covered by trusted patterns
  const trustedHunkCount = useMemo(() => {
    if (!reviewState) return 0;
    const trustList = reviewState.trustList;
    if (trustList.length === 0) return 0;
    return hunks.filter((hunk) => {
      const labels = reviewState.hunks[hunk.id]?.label || [];
      return trustList.some((pattern) =>
        anyLabelMatchesPattern(labels, pattern),
      );
    }).length;
  }, [hunks, reviewState]);

  const allPatternIds = useMemo(
    () => trustCategories.flatMap((c) => c.patterns.map((p) => p.id)),
    [trustCategories],
  );
  const allTrusted = totalPatterns > 0 && trustedCount === totalPatterns;

  const handleSelectHunk = (filePath: string, hunkId: string) => {
    navigateToBrowse(filePath);
    const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
    if (hunkIndex >= 0) {
      useReviewStore.setState({ focusedHunkIndex: hunkIndex });
    }
    setPreviewPatternId(null);
  };

  const allClassified = unlabeledCount === 0;

  return (
    <div className="px-4 mb-6">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="rounded-lg border border-sage-500/[.15] overflow-hidden bg-stone-900">
          {/* ── Filled header (always visible) ── */}
          <CollapsibleTrigger asChild>
            <button className="group flex items-center w-full gap-3 px-3.5 py-3 text-left bg-sage-500/[.12] hover:bg-sage-500/[.18] transition-colors border-b border-sage-500/10">
              {/* Shield icon */}
              <div className="flex items-center justify-center text-sage-400 transition-colors">
                {classifying ? (
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldIcon className="h-4 w-4" />
                )}
              </div>

              {/* Title + subtitle */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-sage-300">
                    Trust Patterns
                  </span>
                  {trustedCount > 0 && (
                    <span className="rounded-full bg-sage-500/20 px-2 py-0.5 text-xxs font-medium text-sage-300 tabular-nums">
                      {trustedCount}/{totalPatterns}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5">
                  {taxonomyLoading ? (
                    <span className="text-stone-400">Loading patterns...</span>
                  ) : classifying ? (
                    <span className="text-sage-400">Classifying hunks...</span>
                  ) : allClassified ? (
                    <>
                      <span className="text-sage-400">All classified</span>
                      {trustedHunkCount > 0 && (
                        <span className="text-sage-400/70">
                          {" "}
                          &middot; {trustedHunkCount} hunk
                          {trustedHunkCount !== 1 ? "s" : ""} auto-approved
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-stone-400">
                      {unlabeledCount} unclassified hunk
                      {unlabeledCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </p>
              </div>

              {/* Chevron */}
              <ChevronIcon
                className={`h-4 w-4 text-sage-500/50 transition-transform duration-200 group-hover:text-sage-500/70 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>

          {/* Error banner (visible even when collapsed) */}
          {classificationError && (
            <div className="mx-3 mt-2 mb-1 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-2xs text-rose-400 inset-ring-1 inset-ring-rose-500/20">
              {classificationError}
            </div>
          )}

          {/* ── Expanded content (neutral interior) ── */}
          <CollapsibleContent>
            {/* Loading state */}
            {taxonomyLoading && (
              <div className="flex items-center justify-center py-6 text-stone-500">
                <SpinnerIcon className="h-4 w-4 animate-spin mr-2" />
                <span className="text-xs">Loading patterns...</span>
              </div>
            )}

            {/* Actions toolbar */}
            <div className="flex items-center flex-wrap gap-2 px-3.5 py-2.5 border-b border-stone-800/60">
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
              {totalPatterns > 0 && (
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
              {!claudeAvailable ? (
                <SimpleTooltip content="Claude CLI not found. Install it to enable AI classification.">
                  <span className="flex items-center gap-1.5 rounded-md bg-stone-800/50 px-2.5 py-1 text-2xs text-stone-500 inset-ring-1 inset-ring-stone-700/40">
                    Auto-classify unavailable
                  </span>
                </SimpleTooltip>
              ) : !autoClassifyEnabled ? (
                <SimpleTooltip content="Auto-classify is off. Click to enable.">
                  <button
                    onClick={() => setAutoClassifyEnabled(true)}
                    className="flex items-center gap-1.5 rounded-md bg-stone-800/50 px-2.5 py-1 text-2xs text-stone-500 inset-ring-1 inset-ring-stone-700/40 hover:bg-stone-800/80 hover:text-stone-300 transition-colors"
                  >
                    Auto-classify off
                  </button>
                </SimpleTooltip>
              ) : null}
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
                Browse Classifications
              </button>
            </div>

            {/* Category grid */}
            <div className="divide-y divide-stone-800/60">
              {trustCategories.map((category) => {
                const categoryTrustedCount = category.patterns.filter((p) =>
                  reviewState?.trustList.includes(p.id),
                ).length;
                const categoryTotalCount = category.patterns.reduce(
                  (sum, p) => sum + (patternCounts[p.id] || 0),
                  0,
                );

                return (
                  <div key={category.id} className="px-3.5 py-2.5">
                    {/* Category label row */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xxs font-medium text-stone-400 uppercase tracking-wider">
                        {category.name}
                      </span>
                      {categoryTrustedCount > 0 && (
                        <span className="text-xxs text-sage-400/70 tabular-nums">
                          {categoryTrustedCount} trusted
                        </span>
                      )}
                      {categoryTotalCount > 0 && (
                        <span className="text-xxs text-stone-500 tabular-nums">
                          {categoryTotalCount} hunk
                          {categoryTotalCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>

                    {/* Pattern chips */}
                    <div className="flex flex-wrap gap-1.5">
                      {category.patterns.map((pattern) => {
                        const isTrusted =
                          reviewState?.trustList.includes(pattern.id) ?? false;
                        const count = patternCounts[pattern.id] || 0;

                        return (
                          <SimpleTooltip
                            key={pattern.id}
                            content={pattern.description}
                          >
                            <button
                              onClick={() =>
                                isTrusted
                                  ? removeTrustPattern(pattern.id)
                                  : addTrustPattern(pattern.id)
                              }
                              className={`group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-all ${
                                isTrusted
                                  ? "bg-sage-500/10 text-sage-300 inset-ring-1 inset-ring-sage-500/20 hover:bg-sage-500/[.18]"
                                  : "bg-stone-800/60 text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-800 hover:text-stone-300"
                              }`}
                            >
                              <Checkbox
                                className="h-3 w-3 flex-shrink-0 pointer-events-none group-hover:data-[state=unchecked]:border-stone-500"
                                checked={isTrusted}
                                tabIndex={-1}
                              />
                              <span className="truncate max-w-[12rem]">
                                {pattern.name}
                              </span>
                              {count > 0 && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewPatternId(
                                      previewPatternId === pattern.id
                                        ? null
                                        : pattern.id,
                                    );
                                  }}
                                  className={`font-mono text-xxs tabular-nums rounded px-1 py-px transition-colors ${
                                    previewPatternId === pattern.id
                                      ? "bg-stone-600 text-stone-200"
                                      : isTrusted
                                        ? "text-sage-400/60 hover:bg-sage-500/[.18] hover:text-sage-300"
                                        : "text-stone-500 hover:bg-stone-700 hover:text-stone-400"
                                  }`}
                                >
                                  {count}
                                </span>
                              )}
                            </button>
                          </SimpleTooltip>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

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
