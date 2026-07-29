import { useState, useCallback, useMemo } from "react";
import { useReviewStore } from "../../stores";
import type { FileEntry } from "../../types";
import { scoreCandidate, foldText, HighlightedText } from "../../lib/fuzzy";
import type { ScoreField } from "../../lib/fuzzy";
import { PaletteDialog, countLabel } from "../palette";
import { FileIcon } from "../ui/icons";

interface FileFinderProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FileMatch {
  path: string;
  /** Offsets into `path`, including any that matched only the filename. */
  matchIndices: number[];
  isChanged: boolean;
}

/** How much more a filename match counts than a match anywhere in the path. */
const NAME_WEIGHT = 1;
const PATH_WEIGHT = 0.6;
/** Proportional bump for files the comparison actually touched. */
const CHANGED_BOOST = 0.2;
const MAX_RESULTS = 50;

/** Shared identity so unmatched rows do not re-memo on every render. */
const EMPTY_INDICES: number[] = [];

// Flatten all files from tree structure, excluding gitignored files
function flattenAllFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    // Skip gitignored files and directories
    if (entry.status === "gitignored") {
      continue;
    }
    if (entry.isDirectory && entry.children) {
      result.push(...flattenAllFiles(entry.children));
    } else if (!entry.isDirectory) {
      result.push(entry);
    }
  }
  return result;
}

interface Candidate {
  path: string;
  /** Where the filename starts within `path`, for remapping match offsets. */
  nameOffset: number;
  fields: ScoreField[];
}

/**
 * Scoring inputs for one file.
 *
 * Built once per file tree rather than per keystroke: the filename split, the
 * case-folds, and the field descriptors all depend only on the path, so
 * rebuilding them for all ~7k files on every character typed was the single
 * biggest cost in this component.
 */
function toCandidate(path: string): Candidate {
  const nameOffset = path.lastIndexOf("/") + 1;
  const name = path.slice(nameOffset);
  return {
    path,
    nameOffset,
    fields: [
      { key: "name", text: name, weight: NAME_WEIGHT, folded: foldText(name) },
      { key: "path", text: path, weight: PATH_WEIGHT, folded: foldText(path) },
    ],
  };
}

export function FileFinder({ isOpen, onClose }: FileFinderProps) {
  const allFiles = useReviewStore((s) => s.allFiles);
  const files = useReviewStore((s) => s.files);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const [query, setQuery] = useState("");

  // Get changed file paths for highlighting
  const changedPaths = useMemo(() => {
    const changed = new Set<string>();
    const collectChanged = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.status && !entry.isDirectory) {
          changed.add(entry.path);
        }
        if (entry.children) {
          collectChanged(entry.children);
        }
      }
    };
    collectChanged(files);
    return changed;
  }, [files]);

  // Flattening walks the whole tree, so it is keyed on the tree alone rather
  // than recomputed for every keystroke.
  const candidates = useMemo(
    () => flattenAllFiles(allFiles).map((file) => toCandidate(file.path)),
    [allFiles],
  );

  const results = useMemo<FileMatch[]>(() => {
    if (!query.trim()) {
      // Show changed files first when no query. Plain `<` rather than
      // `localeCompare`, which invokes Intl collation on every comparison for
      // a list that is about to be sliced to 50.
      return candidates
        .map((candidate) => ({
          path: candidate.path,
          matchIndices: EMPTY_INDICES,
          isChanged: changedPaths.has(candidate.path),
        }))
        .sort((a, b) => {
          if (a.isChanged !== b.isChanged) return a.isChanged ? -1 : 1;
          return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
        })
        .slice(0, MAX_RESULTS);
    }

    const matches: { match: FileMatch; score: number }[] = [];

    for (const candidate of candidates) {
      const isChanged = changedPaths.has(candidate.path);

      const scored = scoreCandidate(query, candidate.fields, {
        boost: isChanged ? CHANGED_BOOST : 0,
      });
      if (!scored) continue;

      // Rows render the full path, so filename offsets are shifted into path
      // space. The filename is always a suffix, which makes this exact.
      const indices = new Set<number>();
      for (const hit of scored.hits) {
        for (const index of hit.indices) {
          indices.add(
            hit.key === "name" ? index + candidate.nameOffset : index,
          );
        }
      }

      matches.push({
        score: scored.score,
        match: {
          path: candidate.path,
          matchIndices: [...indices].sort((a, b) => a - b),
          isChanged,
        },
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.match.isChanged !== b.match.isChanged)
        return a.match.isChanged ? -1 : 1;
      return a.match.path.localeCompare(b.match.path);
    });

    return matches.slice(0, MAX_RESULTS).map((m) => m.match);
  }, [candidates, query, changedPaths]);

  const handleActivate = useCallback(
    (match: FileMatch) => {
      navigateToBrowse(match.path);
      onClose();
    },
    [navigateToBrowse, onClose],
  );

  return (
    <PaletteDialog<FileMatch>
      open={isOpen}
      onClose={onClose}
      title="Find File"
      query={query}
      onQueryChange={setQuery}
      placeholder="Search files by name…"
      items={results}
      getKey={(match) => match.path}
      renderRow={(match) => (
        <div className="flex items-center gap-3 px-4 py-2 text-left">
          <FileIcon
            className={`h-4 w-4 flex-shrink-0 ${
              match.isChanged ? "text-status-modified" : "text-fg-muted"
            }`}
          />

          <div className="flex-1 min-w-0 font-mono text-sm">
            <span className="text-fg-secondary truncate block">
              <HighlightedText text={match.path} indices={match.matchIndices} />
            </span>
          </div>

          {match.isChanged && (
            <span className="text-xxs text-status-modified/80 flex-shrink-0">
              changed
            </span>
          )}
        </div>
      )}
      onActivate={handleActivate}
      emptyMessage={query ? "No matching files" : "No files available"}
      renderCount={(n) => countLabel(n, "file")}
    />
  );
}
