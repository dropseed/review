# core/ — Core Rust Library

This crate contains all business logic with no Tauri dependencies. It can be used standalone via the CLI.

## Module Overview

```
src/
├── classify/       Static hunk classification
│   └── static_classify.rs  Rule-based classification
├── diff/           Git diff parsing
│   └── parser.rs       Parses unified diff format into DiffHunk structs
├── review/         Review state management
│   ├── state.rs        ReviewState struct (hunks, trust_labels, notes)
│   └── storage.rs      JSON persistence to ~/.review/
├── trust/          Trust pattern matching
│   └── patterns.rs     Pattern matching (glob-style), taxonomy loading
├── sources/        Git operations abstraction
│   ├── traits.rs       DiffSource, Comparison, FileEntry traits/types
│   ├── local_git.rs    LocalGitSource (shell out to git CLI)
│   └── github.rs       GitHub PR support via gh CLI
├── narrative/      AI narrative generation (diff summary)
├── symbols/        Tree-sitter symbol extraction
│   └── extractor.rs    Extract/diff symbols across old/new versions
├── filters.rs      File skip rules (generated files, binaries)
├── error.rs        Error types
├── cli/            CLI module (behind `cli` feature flag)
│   └── mod.rs          Parses args, resolves comparison, opens desktop app
└── bin/            CLI binary entry point
```

## Key Data Flow

1. **Diff parsing**: `sources::local_git` runs `git diff` → `diff::parser::parse_diff()` → `Vec<DiffHunk>`
2. **Classification**: `DiffHunk` → `classify::static_classify` → pattern-matched labels
3. **Trust matching**: User's trust list + `trust::patterns::matches_pattern()` → auto-approve matching hunks
4. **Persistence**: `ReviewState` ↔ `~/.review/repos/<repo-id>/reviews/<comparison>.json` via `review::storage`

## State Storage

Review state is stored per-repo in `~/.review/repos/<repo-id>/` (override with `$REVIEW_HOME`). The repo ID is a SHA-256 hash of the canonical repo path.

- `reviews/<comparison>.json` — Hunk labels, approvals, notes
- `current` — Last active comparison
- `custom-patterns.json` — Optional user-defined trust patterns

Review state includes:

- `hunks`: Dict mapping `filepath:hash` to `{label, reasoning, approved_via}`
- `trust_labels`: List of trusted patterns
- `notes`: Free-form review notes
- `comparison`: Structured comparison info

## Trust Patterns Taxonomy

The taxonomy is defined in `resources/taxonomy.json` and loaded at runtime. Pattern format is `category:label` (e.g., `imports:added`, `formatting:whitespace`). Categories: `imports`, `formatting`, `comments`, `type-annotations`, `file`, `move`, `generated`.

Users can extend the taxonomy by creating a `custom-patterns.json` in their review state directory with the same JSON structure. Custom patterns are merged with the bundled taxonomy at runtime.

## Feature Flags

- `cli` — Enables the CLI module and binary. Not compiled for the desktop app.

## Dependencies

- Uses `anyhow` for error handling throughout
- `serde`/`serde_json` for serialization
- `tree-sitter` + language grammars for symbol extraction
- No async runtime — all functions are synchronous (Tauri wraps in `spawn_blocking`)
