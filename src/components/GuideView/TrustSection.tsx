import { type ReactNode, useState, useMemo, useEffect, useRef } from "react";
import { useReviewStore } from "../../stores";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import { anyLabelMatchesPattern, type TrustCategory } from "../../types";
import { getApiClient } from "../../api";
import { Checkbox } from "../ui/checkbox";
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
  const knownPatternIds = new Set<string>();
  for (const category of categories) {
    for (const pattern of category.patterns) {
      knownPatternIds.add(pattern.id);
    }
  }

  const counts = new Map<string, number>();
  for (const hunk of hunks) {
    const labels = hunkStates?.[hunk.id]?.label ?? [];
    for (const label of labels) {
      if (knownPatternIds.has(label)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }

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

function PatternRow({
  pattern,
  onToggle,
  onExpandToggle,
  isExpanded,
  previewHunks,
  onSelectHunk,
  onShowAllModal,
}: {
  pattern: PatternInfo;
  onToggle: (id: string, trusted: boolean) => void;
  onExpandToggle: (id: string) => void;
  isExpanded: boolean;
  previewHunks: PreviewHunk[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
  onShowAllModal: (patternId: string) => void;
}): ReactNode {
  const muted = pattern.count === 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(pattern.id, !pattern.trusted)}
        className={`group flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors ${
          muted ? "opacity-50 hover:opacity-70" : "hover:bg-surface-raised/50"
        }`}
      >
        <Checkbox
          className="h-3 w-3 shrink-0 pointer-events-none group-hover:data-[state=unchecked]:border-edge-default"
          checked={pattern.trusted}
          tabIndex={-1}
        />
        <span
          className={`flex-1 min-w-0 truncate text-xs ${pattern.trusted ? "text-status-trusted" : "text-fg-secondary"}`}
          title={pattern.description}
        >
          {pattern.name}
        </span>
        {pattern.count > 0 ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onExpandToggle(pattern.id);
            }}
            className={`font-mono text-xxs tabular-nums shrink-0 rounded px-1 py-px transition-colors ${
              isExpanded
                ? "bg-surface-active text-fg-secondary"
                : pattern.trusted
                  ? "text-status-trusted/70 hover:bg-status-trusted/15 hover:text-status-trusted"
                  : "text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
            }`}
          >
            {pattern.count}
          </span>
        ) : (
          <span className="font-mono text-xxs tabular-nums shrink-0 text-fg-faint px-1">
            0
          </span>
        )}
      </button>

      {isExpanded && previewHunks.length > 0 && (
        <div className="ml-7 mr-2 mt-0.5 mb-1">
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

  const [trustCategories, setTrustCategories] = useState<TrustCategory[]>([]);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(
    null,
  );
  const [modalPatternId, setModalPatternId] = useState<string | null>(null);
  const [showZeroMatch, setShowZeroMatch] = useState(false);

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
  const { trustedHunkCount } = useTrustCounts(knownPatternIds);

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

  const renderPatternList = (patternList: PatternInfo[]) => {
    const elements: ReactNode[] = [];
    let lastCategoryId = "";

    for (const pattern of patternList) {
      if (pattern.categoryId !== lastCategoryId) {
        lastCategoryId = pattern.categoryId;
        elements.push(
          <div
            key={`cat-${pattern.categoryId}`}
            className="px-2 pt-2 pb-0.5 text-xxs font-medium uppercase tracking-wider text-fg-faint"
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
    <div>
      {/* Pattern list */}
      {trustCategories.length > 0 && (
        <div>
          {renderPatternList(visiblePatterns)}

          {zeroMatchPatterns.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowZeroMatch(!showZeroMatch)}
                className="w-full px-2 py-1.5 text-xxs text-fg-faint hover:text-fg-muted transition-colors text-left"
              >
                {showZeroMatch
                  ? "Hide no-match patterns"
                  : `${zeroMatchPatterns.length} more with no matches`}
              </button>
              {showZeroMatch && renderPatternList(zeroMatchPatterns)}
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {trustCategories.length === 0 && visiblePatterns.length === 0 && (
        <p className="px-2 py-2 text-xxs text-fg-faint">
          No patterns classified yet.
        </p>
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
