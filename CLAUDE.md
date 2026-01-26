# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Compare is a desktop app (built with Tauri) that helps humans review diffs more efficiently. It classifies hunks (individual change blocks), enables bulk-approval of trivial changes, and focuses attention on what needs careful human review. It is **not** an AI code reviewer—it assists the review process.

## Development Commands

```bash
# Setup
scripts/install          # Install dependencies (npm + cargo + pre-commit hook)

# Development
scripts/dev              # Run in development mode with hot reload

# Testing
scripts/test             # TypeScript type check + Rust tests

# Linting/Formatting
scripts/fix              # Auto-fix: prettier + cargo fmt
scripts/pre-commit       # Check only: prettier --check + cargo fmt --check

# Build
scripts/build            # Build production app (outputs to src-tauri/target/release/)
```

## Architecture

### Frontend (React + TypeScript)

- `src/` - React frontend with Vite
  - `components/` - React components
    - `FileTree.tsx` - Full repository file browser with change indicators
    - `CodeViewer.tsx` - Code display with diff highlighting
    - `ComparisonSelector.tsx` - Pick what to compare (working/staged/branch)
    - `ReviewFilePanel.tsx` - Review panel for individual files
    - `TrustPatternsPanel.tsx` - Trust patterns management
  - `stores/` - Zustand state management
  - `types/` - TypeScript type definitions
  - `utils/` - Utility functions

### Backend (Rust + Tauri)

- `src-tauri/src/` - Rust backend
  - `sources/` - Diff source abstraction
    - `traits.rs` - DiffSource trait for extensibility
    - `local_git.rs` - Local git repository implementation
  - `diff/` - Diff parsing
    - `parser.rs` - Parse git diff output into hunks
  - `review/` - Review state management
    - `state.rs` - Review state types
    - `storage.rs` - Persist review state to disk
  - `trust/` - Trust patterns
    - `patterns.rs` - Trust patterns taxonomy
    - `matching.rs` - Glob-style pattern matching
  - `classify/` - Claude classification
    - `claude.rs` - Claude CLI integration
    - `prompt.rs` - Build classification prompts
  - `commands.rs` - Tauri commands exposed to frontend
  - `lib.rs` - Main library entry point

## Key Concepts

- **Hunk**: A single block of changes in a diff, identified by `filepath:hash`
- **Trust Pattern**: Label from the taxonomy (e.g., `imports:added`, `formatting:whitespace`)
- **Trust List**: Patterns the user has chosen to auto-approve
- **Comparison**: The base..compare refs being reviewed

## State Storage

Review state persists in `.git/compare/reviews/<comparison>.json`. Storing inside `.git/` means state is automatically ignored by git and shared across worktrees. State includes:

- `hunks`: Dict mapping `filepath:hash` to `{label, reasoning, approved_via}`
- `trust_labels`: List of trusted patterns
- `notes`: Free-form review notes
- `comparison`: Structured comparison info

## Trust Patterns Taxonomy

Located in `src-tauri/src/trust/patterns.rs`. Categories include:

- `imports:*` - Import statement changes
- `formatting:*` - Whitespace, line length, style
- `comments:*` - Comment changes
- `types:*` - Type annotation changes
- `file:*` - File-level operations (deleted, renamed, moved)
- `code:relocated`, `rename:*` - Code movement
- `generated:*` - Auto-generated files
- `version:bumped` - Version number changes
- `remove:deprecated` - Deprecated code removal
