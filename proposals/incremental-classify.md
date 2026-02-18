# Incremental classification via CLI command

## Problem

Classification currently works as a batch operation: collect all unclassified hunks, split into batches of 5, run up to 2 batches concurrently against Claude. This works but is complex (batch splitting, concurrency semaphores, generation counters for cancellation) and couples the classification orchestration tightly to the Tauri backend.

## Proposal

Add a `review classify` CLI command that classifies a single hunk (or small set) and returns the result. The app spawns its own bundled binary to classify hunks one at a time as it goes, instead of batching internally.

```
review classify --repo /path/to/repo --comparison "main..HEAD" --hunk-id "src/foo.rs:abc123"
→ { "label": ["imports:added"], "reasoning": "..." }
```

## Why a CLI command

Can't rely on `review` being in the user's PATH — but the app knows where its own binary lives inside the .app bundle. Tauri can resolve and spawn it directly. Each invocation is independent: easy to cancel, no shared state, no batch coordination.

## How the app drives it

1. Run static classification first (unchanged — fast and local)
2. Get the list of remaining unclassified hunk IDs
3. For each hunk, spawn `review classify` with the hunk ID
4. On exit, parse the JSON result, update review state and UI immediately
5. Move to the next hunk
6. User can cancel at any point — just stop spawning

No batch splitting, no concurrency semaphore, no generation counter. The app is in full control of pacing and cancellation.

## What changes

| Layer | Change |
|---|---|
| **`review` CLI** | Add `classify` subcommand that classifies a single hunk and prints JSON |
| **`review` core** | Extract single-hunk classify function (already exists as the inner call in `classify_batch`) |
| **Tauri backend** | Spawn the bundled `review` binary instead of calling `classify_hunks_batched` directly |
| **Frontend `classificationSlice`** | Replace batch orchestration with sequential event-driven loop |

## What stays the same

- Static classification pre-pass
- The taxonomy, labels, and `ClassificationResult` types
- Review state storage format
- Frontend event pattern (`classify:batch-complete` or similar per-hunk event)

## Open questions

- Classify sequentially or allow a small concurrency window (e.g. 2-3 in flight)? Sequential is simplest but slower for large diffs.
- Should the CLI command accept multiple hunk IDs to classify in one invocation, or strictly one at a time?
- Does the CLI command need the full hunk content piped via stdin, or can it look up the hunk from the repo + comparison?
