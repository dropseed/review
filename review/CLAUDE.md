# review/ — Core Rust Library

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
│   └── storage.rs      JSON persistence to .git/review/
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
4. **Persistence**: `ReviewState` ↔ `.git/review/reviews/<comparison>.json` via `review::storage`

## Feature Flags

- `cli` — Enables the CLI module and binary. Not compiled for the desktop app.

## Dependencies

- Uses `anyhow` for error handling throughout
- `serde`/`serde_json` for serialization
- `tree-sitter` + language grammars for symbol extraction
- No async runtime — all functions are synchronous (Tauri wraps in `spawn_blocking`)
