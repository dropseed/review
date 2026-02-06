# review/ — Core Rust Library

This crate contains all business logic with no Tauri dependencies. It can be used standalone via the CLI.

## Module Overview

```
src/
├── classify/       Claude-based + static hunk classification
│   ├── claude.rs       Batched Claude API calls (via `claude` CLI)
│   ├── prompt.rs       Prompt construction and HunkInput types
│   └── static_classify.rs  Rule-based classification (no AI)
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
├── cli/            CLI commands (behind `cli` feature flag)
│   └── commands/       Subcommands: classify, open, review
└── bin/            CLI binary entry point
```

## Key Data Flow

1. **Diff parsing**: `sources::local_git` runs `git diff` → `diff::parser::parse_diff()` → `Vec<DiffHunk>`
2. **Classification**: `DiffHunk` → `classify::prompt::HunkInput` → Claude API (batched) → `ClassifyResponse`
3. **Static classification**: `DiffHunk` → `classify::static_classify` → pattern-matched labels (no AI needed)
4. **Trust matching**: User's trust list + `trust::patterns::matches_pattern()` → auto-approve matching hunks
5. **Persistence**: `ReviewState` ↔ `.git/review/reviews/<comparison>.json` via `review::storage`

## Feature Flags

- `cli` — Enables the CLI module and binary. Not compiled for the desktop app.

## Dependencies

- Uses `anyhow` for error handling throughout
- `serde`/`serde_json` for serialization
- `tree-sitter` + language grammars for symbol extraction
- No async runtime — all functions are synchronous (Tauri wraps in `spawn_blocking`)
