import { useState, useMemo, useEffect } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { getApiClient } from "../../api";
import { anyLabelMatchesPattern, type TrustCategory } from "../../types";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "../ui/switch";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import { SimpleTooltip } from "../ui/tooltip";
import { HunkPreviewModal } from "./HunkPreviewPanel";

export function TrustSection() {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const addTrustPattern = useReviewStore((s) => s.addTrustPattern);
  const removeTrustPattern = useReviewStore((s) => s.removeTrustPattern);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const autoClassifyEnabled = useReviewStore((s) => s.autoClassifyEnabled);
  const setAutoClassifyEnabled = useReviewStore(
    (s) => s.setAutoClassifyEnabled,
  );
  const classifying = useReviewStore((s) => s.classifying);
  const classificationError = useReviewStore((s) => s.classificationError);
  const classifyUnlabeledHunks = useReviewStore(
    (s) => s.classifyUnlabeledHunks,
  );
  const reclassifyHunks = useReviewStore((s) => s.reclassifyHunks);

  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [sectionExpanded, setSectionExpanded] = useState(false);
  const [previewPatternId, setPreviewPatternId] = useState<string | null>(null);

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

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleSelectHunk = (filePath: string, hunkId: string) => {
    navigateToBrowse(filePath);
    const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
    if (hunkIndex >= 0) {
      useReviewStore.setState({ focusedHunkIndex: hunkIndex });
    }
    setPreviewPatternId(null);
  };

  return (
    <div className="px-4 mb-6">
      {/* Section header */}
      <button
        className="flex items-center gap-1.5 mb-2 group w-full text-left"
        onClick={() => setSectionExpanded(!sectionExpanded)}
      >
        <svg
          className={`h-3 w-3 text-stone-600 transition-transform ${sectionExpanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 6l6 6-6 6" />
        </svg>
        <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide">
          Trust Patterns
        </h3>
        <span className="text-xxs tabular-nums text-cyan-400/80">
          {trustedCount} of {totalPatterns} trusted
        </span>
      </button>

      {sectionExpanded && (
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          {taxonomyLoading && (
            <div className="flex items-center justify-center py-6 text-stone-500">
              <svg
                className="h-4 w-4 animate-spin mr-2"
                viewBox="0 0 24 24"
                fill="none"
              >
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
              <span className="text-xs">Loading patterns...</span>
            </div>
          )}

          {/* Classification controls */}
          <div className="flex items-center gap-3 border-b border-stone-800/60 px-3 py-2">
            <div className="flex items-center gap-2 flex-1 text-2xs">
              <Switch
                id="auto-classify-toggle"
                checked={autoClassifyEnabled}
                onCheckedChange={setAutoClassifyEnabled}
              />
              <label
                htmlFor="auto-classify-toggle"
                className="text-stone-400 cursor-pointer select-none"
              >
                Auto-classify
              </label>

              {unlabeledCount > 0 && (
                <>
                  <span className="text-stone-600">·</span>
                  {classifying ? (
                    <span className="flex items-center gap-1.5 text-stone-400">
                      <svg
                        className="h-3 w-3 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
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
                      Classifying...
                    </span>
                  ) : (
                    <span className="text-stone-500 tabular-nums">
                      {unlabeledCount} unclassified
                    </span>
                  )}
                </>
              )}

              {unlabeledCount === 0 && (
                <>
                  <span className="text-stone-600">·</span>
                  <span className="flex items-center gap-1 text-stone-500">
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    All classified
                  </span>
                </>
              )}
            </div>

            {unlabeledCount > 0 && !classifying && (
              <button
                onClick={() => classifyUnlabeledHunks()}
                className="text-2xs text-stone-500 hover:text-stone-300 transition-colors whitespace-nowrap"
              >
                Classify now
              </button>
            )}
            {unlabeledCount === 0 && (
              <button
                onClick={() => reclassifyHunks()}
                disabled={classifying}
                className="text-2xs text-stone-500 hover:text-stone-300 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Reclassify
              </button>
            )}
          </div>

          {classificationError && (
            <div className="mx-3 mt-2 mb-1 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-2xs text-rose-400 ring-1 ring-inset ring-rose-500/20">
              {classificationError}
            </div>
          )}

          {trustCategories.map((category) => {
            const isExpanded = expandedCategories.has(category.id);
            const categoryTrustedCount = category.patterns.filter((p) =>
              reviewState?.trustList.includes(p.id),
            ).length;
            const categoryTotalCount = category.patterns.reduce(
              (sum, p) => sum + (patternCounts[p.id] || 0),
              0,
            );

            return (
              <Collapsible
                key={category.id}
                open={isExpanded}
                onOpenChange={() => toggleCategory(category.id)}
              >
                <div className="border-b border-stone-800/60 last:border-b-0">
                  <CollapsibleTrigger asChild>
                    <button
                      className={`group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                        isExpanded ? "bg-stone-800/30" : "hover:bg-stone-800/40"
                      }`}
                    >
                      <svg
                        className={`h-3 w-3 text-stone-500 transition-transform duration-200 ease-out ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>

                      <span className="flex-1 text-xs font-medium text-stone-200 group-hover:text-stone-50">
                        {category.name}
                      </span>

                      <div className="flex items-center gap-2 text-xxs tabular-nums">
                        {categoryTrustedCount > 0 && (
                          <span className="text-cyan-400">
                            {categoryTrustedCount} trusted
                          </span>
                        )}
                        {categoryTotalCount > 0 && (
                          <span className="text-stone-500">
                            {categoryTotalCount} hunk
                            {categoryTotalCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0">
                    <div className="space-y-0.5 pb-2 pl-2 pr-3">
                      {category.patterns.map((pattern) => {
                        const isTrusted =
                          reviewState?.trustList.includes(pattern.id) ?? false;
                        const count = patternCounts[pattern.id] || 0;

                        return (
                          <div key={pattern.id}>
                            <label
                              className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-all duration-150 ${
                                isTrusted
                                  ? "border-l-2 border-l-cyan-500 bg-cyan-500/5 pl-2"
                                  : "border-l-2 border-l-transparent hover:bg-stone-800/40"
                              }`}
                            >
                              <Checkbox
                                className="flex-shrink-0 mt-0.5 group-hover:data-[state=unchecked]:border-stone-500"
                                checked={isTrusted}
                                onCheckedChange={() =>
                                  isTrusted
                                    ? removeTrustPattern(pattern.id)
                                    : addTrustPattern(pattern.id)
                                }
                              />

                              <div className="flex-1 min-w-0">
                                <span
                                  className={`text-xs font-medium transition-colors block truncate ${
                                    isTrusted
                                      ? "text-cyan-200"
                                      : "text-stone-200 group-hover:text-stone-50"
                                  }`}
                                >
                                  {pattern.name}
                                </span>
                                <span className="text-xxs text-stone-500 block truncate">
                                  {pattern.description}
                                </span>
                              </div>

                              {count > 0 && (
                                <SimpleTooltip content="Preview matching hunks">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setPreviewPatternId(
                                        previewPatternId === pattern.id
                                          ? null
                                          : pattern.id,
                                      );
                                    }}
                                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xxs transition-colors ${
                                      previewPatternId === pattern.id
                                        ? "bg-stone-700 text-stone-200"
                                        : "text-stone-500 hover:bg-stone-800 hover:text-stone-400"
                                    }`}
                                  >
                                    <span className="tabular-nums">
                                      {count}
                                    </span>
                                  </button>
                                </SimpleTooltip>
                              )}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
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
