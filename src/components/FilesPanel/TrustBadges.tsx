import { useState, useMemo, useEffect } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { anyLabelMatchesPattern, type TrustCategory } from "../../types";
import { SimpleTooltip } from "../ui/tooltip";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";

export function TrustBadges() {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const addTrustPattern = useReviewStore((s) => s.addTrustPattern);
  const removeTrustPattern = useReviewStore((s) => s.removeTrustPattern);
  const setTrustList = useReviewStore((s) => s.setTrustList);
  const setClassificationsModalOpen = useReviewStore(
    (s) => s.setClassificationsModalOpen,
  );

  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const loadTaxonomy = async () => {
      try {
        const categories = await getApiClient().getTrustTaxonomy();
        setTrustCategories(categories);
      } catch (err) {
        console.error("Failed to load taxonomy:", err);
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

  // Only show patterns that have matching hunks
  const patternsWithMatches = useMemo(() => {
    const result: Array<{
      id: string;
      name: string;
      description: string;
      count: number;
      isTrusted: boolean;
    }> = [];
    for (const category of trustCategories) {
      for (const pattern of category.patterns) {
        const count = patternCounts[pattern.id] || 0;
        if (count > 0) {
          result.push({
            id: pattern.id,
            name: pattern.name,
            description: pattern.description,
            count,
            isTrusted: reviewState?.trustList.includes(pattern.id) ?? false,
          });
        }
      }
    }
    // Sort: trusted first, then by count descending
    result.sort((a, b) => {
      if (a.isTrusted !== b.isTrusted) return a.isTrusted ? -1 : 1;
      return b.count - a.count;
    });
    return result;
  }, [trustCategories, patternCounts, reviewState]);

  const allPatternIds = useMemo(
    () => trustCategories.flatMap((c) => c.patterns.map((p) => p.id)),
    [trustCategories],
  );

  if (patternsWithMatches.length === 0) return null;

  const trustedCount = patternsWithMatches.filter((p) => p.isTrusted).length;
  const allTrusted =
    allPatternIds.length > 0 &&
    (reviewState?.trustList.length ?? 0) === allPatternIds.length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border-b border-stone-800">
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-amber-500/50">
              <svg
                className={`h-3 w-3 text-stone-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              <svg
                className="h-3.5 w-3.5 text-stone-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span className="flex-1">Trust</span>
              {trustedCount > 0 && (
                <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-xxs font-medium text-cyan-300 tabular-nums">
                  {trustedCount}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-center w-6 h-6 mr-1 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors">
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <circle cx="12" cy="5" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  allTrusted ? setTrustList([]) : setTrustList(allPatternIds)
                }
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {allTrusted ? (
                    <path d="M18 6L6 18M6 6l12 12" />
                  ) : (
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  )}
                </svg>
                {allTrusted ? "Untrust all" : "Trust all"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setClassificationsModalOpen(true)}
              >
                <svg
                  className="h-3.5 w-3.5"
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
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CollapsibleContent>
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            {patternsWithMatches.map((pattern) => (
              <SimpleTooltip key={pattern.id} content={pattern.description}>
                <button
                  onClick={() =>
                    pattern.isTrusted
                      ? removeTrustPattern(pattern.id)
                      : addTrustPattern(pattern.id)
                  }
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xxs font-medium transition-colors ${
                    pattern.isTrusted
                      ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                      : "bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-300"
                  }`}
                >
                  <span className="truncate max-w-[10rem]">{pattern.id}</span>
                  <span
                    className={`tabular-nums ${pattern.isTrusted ? "text-cyan-300" : "text-stone-500"}`}
                  >
                    {pattern.count}
                  </span>
                </button>
              </SimpleTooltip>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
