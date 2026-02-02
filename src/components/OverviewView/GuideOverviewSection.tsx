import { useCallback, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { SimpleTooltip } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";

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
  const stale = hasNarrative ? isNarrativeStale() : false;
  const irrelevant = hasNarrative ? isNarrativeIrrelevant() : false;
  const showNarrative = hasNarrative && !irrelevant;

  // Compute a short reason for why the narrative is stale
  const staleReason = useMemo(() => {
    if (!stale || !narrative) return "";
    const storedIds = new Set(narrative.hunkIds);
    const currentIds = new Set(hunks.map((h) => h.id));
    let added = 0;
    let removed = 0;
    for (const id of currentIds) {
      if (!storedIds.has(id)) added++;
    }
    for (const id of storedIds) {
      if (!currentIds.has(id)) removed++;
    }
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} new`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (parts.length === 0) return "";
    return `${parts.join(", ")} hunk${added + removed === 1 ? "" : "s"} since generated`;
  }, [stale, narrative, hunks]);

  const setNarrativeSidebarOpen = useReviewStore(
    (s) => s.setNarrativeSidebarOpen,
  );
  const setLastClickedNarrativeLinkOffset = useReviewStore(
    (s) => s.setLastClickedNarrativeLinkOffset,
  );

  const handleNavigate = useCallback(
    (offset: number, filePath: string, hunkId?: string) => {
      setLastClickedNarrativeLinkOffset(offset);
      setNarrativeSidebarOpen(true);
      navigateToBrowse(filePath);
      if (hunkId) {
        const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
        if (hunkIndex >= 0) {
          useReviewStore.setState({ focusedHunkIndex: hunkIndex });
        }
      }
    },
    [
      navigateToBrowse,
      hunks,
      setNarrativeSidebarOpen,
      setLastClickedNarrativeLinkOffset,
    ],
  );

  const markdownComponents = useMemo(
    () => ({
      a: ({
        href,
        children,
        node,
      }: {
        href?: string;
        children?: React.ReactNode;
        node?: { position?: { start: { offset?: number } } };
      }) => {
        if (href?.startsWith("review://")) {
          const url = new URL(href.replace("review://", "http://placeholder/"));
          const filePath = url.pathname.slice(1);
          const hunkId = url.searchParams.get("hunk") || undefined;
          const offset = node?.position?.start?.offset ?? -1;
          const childText = typeof children === "string" ? children : "";
          const fileName = filePath.split("/").pop() ?? "";
          const needsTooltip = childText !== filePath && childText !== fileName;
          const link = (
            <button
              onClick={() => handleNavigate(offset, filePath, hunkId)}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer"
            >
              {children}
            </button>
          );
          if (needsTooltip) {
            return (
              <SimpleTooltip content={filePath} side="bottom">
                {link}
              </SimpleTooltip>
            );
          }
          return link;
        }
        return (
          <button
            onClick={() => {
              if (href) {
                getPlatformServices().opener.openUrl(href);
              }
            }}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer"
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
        <div className="rounded-lg border border-stone-700/40 bg-stone-800/30 overflow-hidden">
          <div className="px-5 py-4">
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5">
                <div className="text-xxs font-medium text-stone-400 uppercase tracking-wider">
                  Narrative
                </div>
                <svg
                  className="h-3 w-3 text-purple-400/60"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
                <div className="flex-1" />
                {narrativeGenerating && (
                  <div className="flex items-center gap-1.5 text-purple-400">
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
                    <span className="text-xxs">Generating...</span>
                  </div>
                )}
                {stale && !narrativeGenerating && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xxs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors">
                        {staleReason || "outdated"}
                        <svg
                          className="h-2.5 w-2.5"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                        >
                          <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
                        </svg>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={generateNarrative}>
                        <svg
                          className="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                        </svg>
                        Regenerate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="guide-prose text-stone-200 text-sm">
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
        </div>
      ) : (
        /* Empty / generating state card */
        <div className="rounded-lg border border-stone-700/60 overflow-hidden bg-stone-900">
          <div className="flex items-center w-full gap-3 px-3.5 py-3 bg-stone-800/40">
            {/* Icon */}
            <div className="flex items-center justify-center">
              {narrativeGenerating ? (
                <svg
                  className="h-4 w-4 animate-spin text-purple-400"
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
                  className="h-4 w-4 text-purple-400"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
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
