# Snapshot Review

Review the full state of a repo at any ref — not a diff between two branches, but everything that exists at a point in time.

## How it works

Diff against the git **empty tree SHA** (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`). This produces a diff where every file appears as "added," showing the complete content at that ref. The entire existing pipeline (hunks, classification, trust patterns, approve/reject) works unchanged.

## Key format

`snapshot:<ref>` — e.g., `snapshot:HEAD`, `snapshot:v1.0.0`, `snapshot:main`

## UI

Add a mode toggle to the comparison picker: **Compare** (existing base..compare) vs **Snapshot** (single ref picker). In snapshot mode, the base dropdown is hidden and the user just picks a ref.

## What changes

- **`src/types/index.ts`** — `makeSnapshotComparison()`, `isSnapshotComparison()`, `EMPTY_TREE_SHA` constant
- **`src/hooks/useRepositoryInit.ts`** — `parseComparisonKey()` handles `snapshot:` prefix
- **`src/components/ComparisonPicker/NewComparisonForm.tsx`** — mode toggle + snapshot submit
- **Display labels** — show "Snapshot: ref" instead of raw empty tree SHA in breadcrumbs, tab rail, overview

## What stays the same

All Rust code. The `Comparison` interface. Classification, trust patterns, storage, file watching — everything downstream of comparison creation.
