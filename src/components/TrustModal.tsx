import { useState, useMemo, useEffect, useRef } from "react";
import { useReviewStore } from "../stores/reviewStore";
import { anyLabelMatchesPattern } from "../utils/matching";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
import type { TrustCategory } from "../types";

interface TrustModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TrustModal({ isOpen, onClose }: TrustModalProps) {
  const {
    hunks,
    reviewState,
    addTrustPattern,
    removeTrustPattern,
    claudeAvailable,
    classifying,
    classificationError,
    checkClaudeAvailable,
    classifyUnlabeledHunks,
    reclassifyHunks,
    setSelectedFile,
  } = useReviewStore();

  // Taxonomy loaded from backend
  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);

  // Track which categories are expanded
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );

  // Track preview state
  const [previewPatternId, setPreviewPatternId] = useState<string | null>(null);

  // Track previous classifying state to detect completion
  const wasClassifying = useRef(false);

  // Check Claude availability on mount
  useEffect(() => {
    if (isOpen) {
      checkClaudeAvailable();
    }
  }, [isOpen, checkClaudeAvailable]);

  // Load taxonomy from backend when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const loadTaxonomy = async () => {
      setTaxonomyLoading(true);
      try {
        const categories = await getApiClient().getTrustTaxonomy();
        setTrustCategories(categories);
        // Expand all categories by default
        setExpandedCategories(new Set(categories.map((c) => c.id)));
      } catch (err) {
        console.error("Failed to load taxonomy:", err);
      } finally {
        setTaxonomyLoading(false);
      }
    };

    loadTaxonomy();
  }, [isOpen]);

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Send notification when classification completes
  useEffect(() => {
    const notifyCompletion = async () => {
      if (wasClassifying.current && !classifying && !classificationError) {
        // Classification just completed successfully
        const platform = getPlatformServices();
        const hasPermission = await platform.notifications.requestPermission();
        if (hasPermission) {
          await platform.notifications.show(
            "Classification Complete",
            "All hunks have been classified by Claude.",
          );
        }
      }
      wasClassifying.current = classifying;
    };
    notifyCompletion();
  }, [classifying, classificationError]);

  // Count hunks that match each pattern
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
  }, [hunks, reviewState]);

  // Compute matching hunks for preview
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

  // Get pattern name for preview header
  const previewPatternName = useMemo(() => {
    if (!previewPatternId) return "";
    for (const category of trustCategories) {
      const pattern = category.patterns.find((p) => p.id === previewPatternId);
      if (pattern) return pattern.name;
    }
    return previewPatternId;
  }, [previewPatternId]);

  // Count unlabeled hunks
  const unlabeledCount = useMemo(() => {
    return hunks.filter((hunk) => {
      const state = reviewState?.hunks[hunk.id];
      return !state?.label || state.label.length === 0;
    }).length;
  }, [hunks, reviewState]);

  // Count total trusted patterns
  const trustedCount = reviewState?.trustList.length ?? 0;

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

  const handleSelectHunk = (filePath: string) => {
    setSelectedFile(filePath);
    setPreviewPatternId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-stone-700 bg-stone-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-stone-100">
              Trust Settings
            </h2>
            {trustedCount > 0 && (
              <span className="text-xxs tabular-nums text-cyan-400">
                {trustedCount} trusted
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
            aria-label="Close trust settings"
          >
            <svg
              className="h-5 w-5"
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Categories */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {taxonomyLoading && (
            <div className="flex items-center justify-center py-8 text-stone-500">
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
              <div key={category.id} className="border-b border-stone-800/60">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(category.id)}
                  className={`group flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors ${
                    isExpanded ? "bg-stone-800/30" : "hover:bg-stone-800/40"
                  }`}
                >
                  {/* Expand icon */}
                  <svg
                    className={`h-3.5 w-3.5 text-stone-400 transition-transform duration-200 ease-out ${
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

                  {/* Category name */}
                  <span className="flex-1 text-xs font-medium text-stone-200 group-hover:text-stone-50">
                    {category.name}
                  </span>

                  {/* Stats */}
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

                {/* Patterns - animated collapse */}
                <div
                  className={`overflow-hidden transition-all duration-200 ease-out ${
                    isExpanded
                      ? "max-h-[33rem] opacity-100"
                      : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="space-y-0.5 pb-2 pl-3 pr-4">
                    {category.patterns.map((pattern) => {
                      const isTrusted =
                        reviewState?.trustList.includes(pattern.id) ?? false;
                      const count = patternCounts[pattern.id] || 0;

                      return (
                        <label
                          key={pattern.id}
                          className={`group flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-all duration-150 ${
                            isTrusted
                              ? "border-l-2 border-l-cyan-500 bg-cyan-500/5 pl-2"
                              : "border-l-2 border-l-transparent hover:bg-stone-800/40"
                          }`}
                        >
                          {/* Custom checkbox */}
                          <div className="relative mt-0.5 flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={isTrusted}
                              onChange={() =>
                                isTrusted
                                  ? removeTrustPattern(pattern.id)
                                  : addTrustPattern(pattern.id)
                              }
                              className="peer sr-only"
                            />
                            <div
                              className={`flex h-4 w-4 items-center justify-center rounded border transition-all duration-150 ${
                                isTrusted
                                  ? "border-cyan-500 bg-cyan-500"
                                  : "border-stone-600 bg-stone-800 group-hover:border-stone-500"
                              }`}
                            >
                              <svg
                                className={`h-2.5 w-2.5 transition-all duration-150 ${
                                  isTrusted
                                    ? "scale-100 text-stone-900 opacity-100"
                                    : "scale-75 opacity-0"
                                }`}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </div>
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-medium transition-colors ${
                                  isTrusted
                                    ? "text-cyan-200"
                                    : "text-stone-200 group-hover:text-stone-50"
                                }`}
                              >
                                {pattern.name}
                              </span>
                              {count > 0 && (
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
                                  title="Preview matching hunks"
                                >
                                  <span className="tabular-nums">{count}</span>
                                </button>
                              )}
                            </div>
                            <p
                              className={`mt-0.5 text-xxs leading-relaxed transition-colors text-pretty ${
                                isTrusted
                                  ? "text-cyan-200/80"
                                  : "text-stone-400"
                              }`}
                            >
                              {pattern.description}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Hunk Preview Panel */}
        {previewPatternId && previewHunks.length > 0 && (
          <div className="border-t border-stone-700 bg-stone-850">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-800 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-stone-300">
                  {previewPatternName}
                </span>
                <span className="text-xxs tabular-nums text-stone-500">
                  {previewHunks.length} match
                  {previewHunks.length !== 1 ? "es" : ""}
                </span>
              </div>
              <button
                onClick={() => setPreviewPatternId(null)}
                className="p-0.5 text-stone-500 hover:text-stone-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50"
                title="Close preview"
                aria-label="Close preview"
              >
                <svg
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Hunk list */}
            <div className="max-h-40 overflow-y-auto scrollbar-thin">
              {previewHunks.map((hunk) => (
                <button
                  key={hunk.id}
                  onClick={() => handleSelectHunk(hunk.filePath)}
                  className="group w-full text-left px-4 py-2 border-b border-stone-800/50 last:border-b-0 hover:bg-stone-800/60 transition-colors"
                >
                  {/* File path */}
                  <div className="text-xxs font-medium text-stone-400 truncate group-hover:text-stone-200">
                    {hunk.filePath}
                  </div>
                  {/* Content preview */}
                  <div className="mt-0.5 font-mono text-xxs text-stone-600 truncate group-hover:text-stone-500">
                    {hunk.content
                      .split("\n")
                      .slice(0, 2)
                      .join(" ")
                      .slice(0, 80)}
                    {hunk.content.length > 80 && "…"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Classification status - subtle footer */}
        <div className="border-t border-stone-800 px-4 py-2.5">
          <div className="flex items-center justify-between text-2xs">
            {claudeAvailable && unlabeledCount > 0 && (
              <>
                <span className="text-stone-500">
                  {classifying ? (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="h-3 w-3 animate-spin text-stone-400"
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
                      <span className="text-stone-400">Classifying…</span>
                    </span>
                  ) : (
                    <span className="tabular-nums">
                      {unlabeledCount} hunk{unlabeledCount !== 1 ? "s" : ""}{" "}
                      unclassified
                    </span>
                  )}
                </span>
                {!classifying && (
                  <button
                    onClick={() => classifyUnlabeledHunks()}
                    className="text-stone-500 hover:text-stone-300 transition-colors"
                  >
                    Classify now
                  </button>
                )}
              </>
            )}

            {claudeAvailable && unlabeledCount === 0 && hunks.length > 0 && (
              <>
                <span className="flex items-center gap-1.5 text-stone-500">
                  <svg
                    className="h-3 w-3 text-stone-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  All hunks classified
                </span>
                <button
                  onClick={() => reclassifyHunks()}
                  disabled={classifying}
                  className="text-stone-500 hover:text-stone-300 transition-colors disabled:opacity-50"
                >
                  Reclassify
                </button>
              </>
            )}

            {claudeAvailable === false && (
              <span className="text-stone-500">
                Install{" "}
                <a
                  href="https://claude.ai/code"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-400 hover:text-stone-300 underline decoration-stone-600 hover:decoration-stone-500"
                >
                  Claude CLI
                </a>{" "}
                for auto-classification
              </span>
            )}
          </div>

          {classificationError && (
            <div className="mt-2 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-2xs text-rose-400 ring-1 ring-inset ring-rose-500/20">
              {classificationError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
