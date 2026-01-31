import { useState, useCallback, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewStore } from "../../stores/reviewStore";
import { getPlatformServices } from "../../platform";
import { SimpleTooltip } from "../ui/tooltip";

export function GuideOverviewSection() {
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useReviewStore((s) => s.hunks);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const narrativeGenerating = useReviewStore((s) => s.narrativeGenerating);
  const narrativeError = useReviewStore((s) => s.narrativeError);
  const isNarrativeStale = useReviewStore((s) => s.isNarrativeStale);
  const generateNarrative = useReviewStore((s) => s.generateNarrative);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const narrative = reviewState?.narrative;
  const prBody = reviewState?.comparison?.githubPr?.body;
  const hasNarrative = !!narrative?.content;
  const hasContent = hasNarrative || !!prBody;

  const stale = useMemo(
    () => (hasNarrative ? isNarrativeStale() : false),
    [hasNarrative, isNarrativeStale],
  );

  const [sectionExpanded, setSectionExpanded] = useState(hasContent);

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

  // Hide section if no content and no ability to generate
  if (!hasContent && !narrativeGenerating && claudeAvailable === false)
    return null;

  return (
    <div className="px-4 mb-4">
      {/* Section header */}
      <button
        className="flex items-center gap-1.5 mb-2 group w-full text-left"
        onClick={() => setSectionExpanded(!sectionExpanded)}
        aria-expanded={sectionExpanded}
      >
        <svg
          className={`h-3 w-3 text-stone-600 transition-transform ${sectionExpanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 6l6 6-6 6" />
        </svg>
        <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide">
          Guide
        </h3>
        {stale && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium text-amber-400">
            outdated
          </span>
        )}
      </button>

      {sectionExpanded && (
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          <div className="px-4 py-3 space-y-3">
            {/* PR Description */}
            {prBody && (
              <div className="space-y-1.5">
                <div className="text-xxs font-medium text-stone-500 uppercase tracking-wider">
                  PR Description
                </div>
                <div className="guide-prose text-stone-300">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) =>
                      url.startsWith("review://")
                        ? url
                        : defaultUrlTransform(url)
                    }
                    components={markdownComponents}
                  >
                    {prBody}
                  </Markdown>
                </div>
              </div>
            )}

            {/* Separator */}
            {prBody && hasNarrative && (
              <div className="border-t border-stone-800" />
            )}

            {/* Narrative content */}
            {hasNarrative && (
              <div className="space-y-1.5">
                <div className="text-xxs font-medium text-stone-500 uppercase tracking-wider">
                  AI Walkthrough
                </div>
                <div className="guide-prose text-stone-300">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) =>
                      url.startsWith("review://")
                        ? url
                        : defaultUrlTransform(url)
                    }
                    components={markdownComponents}
                  >
                    {narrative!.content}
                  </Markdown>
                </div>
              </div>
            )}

            {/* Generating state */}
            {narrativeGenerating && (
              <div className="flex items-center gap-2 py-2">
                <div className="h-3.5 w-3.5 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
                <span className="text-xs text-stone-500">
                  Generating narrative...
                </span>
              </div>
            )}

            {/* Error state */}
            {narrativeError && !narrativeGenerating && (
              <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5">
                {narrativeError}
              </div>
            )}

            {/* Action buttons */}
            {!narrativeGenerating && (
              <div className="flex items-center gap-2">
                {!hasNarrative ? (
                  <SimpleTooltip
                    content={
                      claudeAvailable === false
                        ? "Claude CLI not available"
                        : "Generate a narrative walkthrough of the changes"
                    }
                  >
                    <button
                      onClick={generateNarrative}
                      disabled={claudeAvailable === false}
                      className="text-xs px-2.5 py-1 rounded bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-stone-200 disabled:opacity-40 disabled:cursor-not-allowed border border-stone-700"
                    >
                      Generate Narrative
                    </button>
                  </SimpleTooltip>
                ) : stale ? (
                  <SimpleTooltip content="Changes have been updated since the narrative was generated">
                    <button
                      onClick={generateNarrative}
                      className="text-xs px-2.5 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20"
                    >
                      Regenerate
                    </button>
                  </SimpleTooltip>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
