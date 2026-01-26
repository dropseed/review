import { useState, useMemo, useEffect, useRef } from "react";
import { useReviewStore } from "../stores/reviewStore";
import { trustCategories } from "../constants/trustPatterns";
import { anyLabelMatchesPattern } from "../utils/matching";
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

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
    setSelectedFile,
  } = useReviewStore();

  // Track which categories are expanded
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(trustCategories.map((c) => c.id)),
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
        let hasPermission = await isPermissionGranted();
        if (!hasPermission) {
          const permission = await requestPermission();
          hasPermission = permission === "granted";
        }
        if (hasPermission) {
          sendNotification({
            title: "Classification Complete",
            body: "All hunks have been classified by Claude.",
          });
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
        <div className="flex items-center justify-between border-b border-stone-800 border-t-2 border-t-amber-500/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-stone-50">
              Trust Settings
            </h2>
            {trustedCount > 0 && (
              <div className="flex items-center gap-1.5 rounded bg-amber-500/15 px-2 py-1 ring-1 ring-amber-500/30">
                <svg
                  className="h-3 w-3 text-amber-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-xxs font-medium tabular-nums text-amber-300">
                  {trustedCount} pattern{trustedCount !== 1 ? "s" : ""} trusted
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
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
          {trustCategories.map((category, categoryIndex) => {
            const isExpanded = expandedCategories.has(category.id);
            const categoryTrustedCount = category.patterns.filter((p) =>
              reviewState?.trustList.includes(p.id),
            ).length;
            const categoryTotalCount = category.patterns.reduce(
              (sum, p) => sum + (patternCounts[p.id] || 0),
              0,
            );

            return (
              <div
                key={category.id}
                className="border-b border-stone-800/60"
                style={{ animationDelay: `${categoryIndex * 30}ms` }}
              >
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

                  {/* Stats badges - with text labels */}
                  <div className="flex items-center gap-2">
                    {categoryTrustedCount > 0 && (
                      <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xxs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
                        <svg
                          className="h-2.5 w-2.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="tabular-nums">
                          {categoryTrustedCount}
                        </span>
                        <span className="text-amber-400/70">trusted</span>
                      </span>
                    )}
                    {categoryTotalCount > 0 && (
                      <span className="flex items-center gap-1 rounded bg-stone-700/60 px-1.5 py-0.5 text-xxs font-medium text-stone-400">
                        <span className="tabular-nums">
                          {categoryTotalCount}
                        </span>
                        <span className="text-stone-500">
                          hunk{categoryTotalCount !== 1 ? "s" : ""}
                        </span>
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
                    {category.patterns.map((pattern, patternIndex) => {
                      const isTrusted =
                        reviewState?.trustList.includes(pattern.id) ?? false;
                      const count = patternCounts[pattern.id] || 0;

                      return (
                        <label
                          key={pattern.id}
                          className={`group flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-all duration-150 ${
                            isTrusted
                              ? "border-l-4 border-l-amber-500 bg-amber-500/10 pl-1.5"
                              : "border-l-4 border-l-transparent hover:bg-stone-800/50"
                          }`}
                          style={{ animationDelay: `${patternIndex * 20}ms` }}
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
                                  ? "border-amber-500 bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
                                  : "border-stone-500 bg-stone-800 group-hover:border-stone-400"
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
                                    ? "text-amber-200"
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
                                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xxs transition-all ${
                                    previewPatternId === pattern.id
                                      ? "border-violet-500/50 bg-violet-500/20 text-violet-300"
                                      : isTrusted
                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50"
                                        : "border-stone-600 bg-stone-800 text-stone-400 hover:border-stone-500 hover:bg-stone-700 hover:text-stone-300"
                                  }`}
                                  title="Click to preview matching hunks"
                                >
                                  <svg
                                    className="h-2.5 w-2.5"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  <span>
                                    {count} match{count !== 1 ? "es" : ""}
                                  </span>
                                </button>
                              )}
                            </div>
                            <p
                              className={`mt-0.5 text-xxs leading-relaxed transition-colors text-pretty ${
                                isTrusted
                                  ? "text-amber-200/80"
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
          <div className="border-t-2 border-t-violet-500/40 border-b border-b-stone-700/50 bg-stone-800/40">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-700/50 px-4 py-2">
              <div className="flex items-center gap-2">
                <svg
                  className="h-3.5 w-3.5 text-violet-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="text-xs font-medium text-violet-200">
                  {previewPatternName}
                </span>
                <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-xxs font-medium tabular-nums text-violet-300 ring-1 ring-inset ring-violet-500/30">
                  {previewHunks.length} match
                  {previewHunks.length !== 1 ? "es" : ""}
                </span>
              </div>
              <button
                onClick={() => setPreviewPatternId(null)}
                className="p-0.5 text-stone-400 hover:text-stone-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
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
            <div className="max-h-48 overflow-y-auto scrollbar-thin">
              {previewHunks.map((hunk) => (
                <button
                  key={hunk.id}
                  onClick={() => handleSelectHunk(hunk.filePath)}
                  className="group w-full text-left px-4 py-2 border-b border-stone-800/50 last:border-b-0 hover:bg-violet-500/10 transition-colors"
                >
                  {/* File path */}
                  <div className="text-xxs font-medium text-stone-300 truncate group-hover:text-violet-200">
                    {hunk.filePath}
                  </div>
                  {/* Content preview */}
                  <div className="mt-1 font-mono text-xxs text-stone-500 truncate group-hover:text-stone-400">
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

        {/* Classification section */}
        <div className="border-t border-stone-700/50 bg-gradient-to-b from-stone-800/20 to-stone-900/50 p-4">
          {claudeAvailable && unlabeledCount > 0 && (
            <button
              onClick={() => classifyUnlabeledHunks()}
              disabled={classifying}
              className={`group relative w-full overflow-hidden rounded-md px-4 py-2.5 text-xs font-medium transition-all duration-200 ${
                classifying
                  ? "cursor-wait bg-stone-800 text-stone-400"
                  : "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:brightness-110"
              }`}
            >
              {/* Shimmer effect when not classifying */}
              {!classifying && (
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              )}

              <span className="relative flex items-center justify-center gap-2">
                {classifying ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
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
                    <span>Classifying hunks…</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                    </svg>
                    <span>Classify with Claude</span>
                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-xxs font-semibold tabular-nums">
                      {unlabeledCount}
                    </span>
                  </>
                )}
              </span>
            </button>
          )}

          {claudeAvailable && unlabeledCount === 0 && hunks.length > 0 && (
            <div className="flex items-center justify-center gap-2 rounded-md bg-lime-500/10 px-3 py-2 text-xs text-lime-400 ring-1 ring-inset ring-lime-500/20">
              <svg
                className="h-3.5 w-3.5 text-lime-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="font-medium">All hunks classified</span>
            </div>
          )}

          {claudeAvailable === false && (
            <div className="rounded-md bg-stone-800/50 px-3 py-2.5 text-center text-2xs text-stone-300 ring-1 ring-inset ring-stone-700">
              Install{" "}
              <a
                href="https://claude.ai/code"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-violet-400 hover:text-violet-300 underline decoration-violet-400/30 hover:decoration-violet-300/50"
              >
                Claude CLI
              </a>{" "}
              for auto-classification
            </div>
          )}

          {classificationError && (
            <div className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-2xs text-rose-400 ring-1 ring-inset ring-rose-500/20">
              {classificationError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
