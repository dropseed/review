# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

human-review is a VS Code extension that helps humans review diffs more efficiently. It classifies hunks (individual change blocks), enables bulk-approval of trivial changes, and focuses attention on what needs careful human review. It is **not** an AI code reviewer—it assists the review process.

## Development Commands

```bash
# Setup
scripts/install          # Install dependencies (npm install + pre-commit hook)

# Testing
scripts/test             # Build the extension

# Linting/Formatting
scripts/fix              # Auto-fix: prettier, oxfmt --write, oxlint --fix
scripts/pre-commit       # Check only: prettier --check, oxfmt --check, oxlint

# Build extension
cd vscode && npm run build
```

## Architecture

### VS Code Extension (`vscode/`)

TypeScript-based VS Code extension:

```bash
cd vscode
npm install
npm run build        # Build extension
npm run package      # Creates .vsix
```

Uses oxfmt for formatting and oxlint for linting.

**Core Modules:**

- `src/state/` - State management
  - `types.ts` - Interfaces for Comparison, HunkState, ReviewState, DiffHunk
  - `StateService.ts` - Load/save review state JSON files
- `src/diff/` - Diff parsing
  - `parser.ts` - Parse git diff output into hunks
- `src/git/` - Git operations
  - `operations.ts` - Git command wrappers (git diff, merge-base, etc.)
- `src/trust/` - Trust patterns
  - `patterns.ts` - Trust patterns taxonomy
  - `matching.ts` - Glob-style pattern matching
- `src/classify/` - Claude classification
  - `claude.ts` - Claude CLI integration
  - `prompt.ts` - Build classification prompts
- `src/review/` - Review status computation
  - `status.ts` - Compute review progress
- `src/providers/` - VS Code providers
  - `FileTreeProvider.ts` - Tree view for files
  - `ReviewViewProvider.ts` - Webview for review panel
  - `DiffDecorationProvider.ts` - Gutter decorations
  - `GitProvider.ts` - VS Code Git API wrapper
- `src/extension.ts` - Extension entry point

## Key Concepts

- **Hunk**: A single block of changes in a diff, identified by `filepath:hash`
- **Trust Pattern**: Label from the taxonomy (e.g., `imports:added`, `formatting:whitespace`)
- **Trust List**: Patterns the user has chosen to auto-approve
- **Comparison**: The base..compare refs being reviewed (stored in `.git/human-review/current`)

## State Storage

Review state persists in `.git/human-review/reviews/<comparison>.json`. Storing inside `.git/` means state is automatically ignored by git and shared across worktrees. State includes:

- `hunks`: Dict mapping `filepath:hash` to `{label, reasoning, approved_via}`
- `trust_label`: List of trusted patterns
- `notes`: Free-form review notes
- `comparison`: Structured comparison info (old, new, working_tree)

## Trust Patterns Taxonomy

Located in `vscode/src/trust/patterns.ts`. Categories include:

- `imports:*` - Import statement changes
- `formatting:*` - Whitespace, line length, style
- `comments:*` - Comment changes
- `types:*` - Type annotation changes
- `file:*` - File-level operations (deleted, renamed, moved)
- `code:relocated`, `rename:*` - Code movement
- `generated:*` - Auto-generated files
- `version:bumped` - Version number changes
- `remove:deprecated` - Deprecated code removal
