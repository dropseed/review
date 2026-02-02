import { useCallback, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { SimpleTooltip } from "../ui/tooltip";

export function GuideOverviewSection() {
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useReviewStore((s) => s.hunks);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const narrativeGenerating = useReviewStore((s) => s.narrativeGenerating);
  const narrativeError = useReviewStore((s) => s.narrativeError);
  const isNarrativeStale = useReviewStore((s) => s.isNarrativeStale);
  const isNarrativeIrrelevant = useReviewStore((s) => s.isNarrativeIrrelevant);
  const generateNarrative = useReviewStore((s) => s.generateNarrative);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const narrative = reviewState?.narrative;
  const hasNarrative = !!narrative?.content;
  const stale = useMemo(
    () => (hasNarrative ? isNarrativeStale() : false),
    [hasNarrative, isNarrativeStale],
  );
  const irrelevant = useMemo(
    () => (hasNarrative ? isNarrativeIrrelevant() : false),
    [hasNarrative, isNarrativeIrrelevant],
  );
  const showNarrative = hasNarrative && !irrelevant;

  const handleNavigate = useCallback(
    (filePath: string, hunkId?: string) => {
      navigateToBrowse(filePath);
      if (hunkId) {
        const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
        if (hunkIndex >= 0) {
          useReviewStore.setState({ focusedHunkIndex: hunkIndex });
        }
      }
    },
    [navigateToBrowse, hunks],
  );

  const markdownComponents = useMemo(
    () => ({
      a: ({
        href,
        children,
      }: {
        href?: string;
        children?: React.ReactNode;
      }) => {
        if (href?.startsWith("review://")) {
          const url = new URL(href.replace("review://", "http://placeholder/"));
          const filePath = url.pathname.slice(1);
          const hunkId = url.searchParams.get("hunk") || undefined;
          return (
            <button
              onClick={() => handleNavigate(filePath, hunkId)}
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 decoration-amber-400/40 hover:decoration-amber-300/60 cursor-pointer"
            >
              {children}
            </button>
          );
        }
        return (
          <button
            onClick={() => {
              if (href) {
                getPlatformServices().opener.openUrl(href);
              }
            }}
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 cursor-pointer"
          >
            {children}
          </button>
        );
      },
    }),
    [handleNavigate],
  );

  const showNarrativeSection =
    showNarrative || narrativeGenerating || claudeAvailable !== false;

  if (!showNarrativeSection) return null;

  return (
    <div className="px-4 mb-6">
      {showNarrative ? (
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          <div className="px-4 py-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="text-xxs font-medium text-stone-500 uppercase tracking-wider">
                  AI Walkthrough
                </div>
                {stale && (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium text-amber-400">
                    outdated
                  </span>
                )}
              </div>
              <div className="guide-prose text-stone-300">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) =>
                    url.startsWith("review://") ? url : defaultUrlTransform(url)
                  }
                  components={markdownComponents}
                >
                  {narrative!.content}
                </Markdown>
              </div>
            </div>
          </div>

          {/* Regenerate bar when stale */}
          {stale && !narrativeGenerating && (
            <div className="flex items-center gap-2 px-4 py-2 border-t border-stone-800 bg-stone-900/50">
              <SimpleTooltip content="Changes have been updated since the narrative was generated">
                <button
                  onClick={generateNarrative}
                  className="text-2xs text-amber-400/70 hover:text-amber-400 transition-colors"
                >
                  Regenerate narrative
                </button>
              </SimpleTooltip>
            </div>
          )}
        </div>
      ) : (
        /* Empty / generating state card */
        <div className="rounded-lg border border-stone-700/60 overflow-hidden bg-stone-900">
          <div className="flex items-center w-full gap-3 px-3.5 py-3 bg-stone-800/40">
            {/* Icon */}
            <div className="flex items-center justify-center text-stone-400">
              {narrativeGenerating ? (
                <svg
                  className="h-4 w-4 animate-spin"
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
              ) : (
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              )}
            </div>

            {/* Title + subtitle */}
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-stone-300">
                Narrative
              </span>
              <p className="text-xs text-stone-500 mt-0.5">
                {narrativeGenerating
                  ? "Generating walkthrough..."
                  : "Generate an AI walkthrough of the changes"}
              </p>
            </div>

            {/* Action */}
            {!narrativeGenerating && claudeAvailable !== false && (
              <button
                onClick={generateNarrative}
                className="flex-shrink-0 rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors"
              >
                Generate
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error state */}
      {narrativeError && !narrativeGenerating && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5 mt-2">
          {narrativeError}
        </div>
      )}
    </div>
  );
}
