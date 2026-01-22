# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

human-review is a Claude Code skill and CLI tool that helps humans review diffs more efficiently. It classifies hunks (individual change blocks), enables bulk-approval of trivial changes, and focuses attention on what needs careful human review. It is **not** an AI code reviewer—it assists the review process.

## Development Commands

```bash
# Setup
scripts/install          # Install dependencies (uv sync + pre-commit hook + vscode npm)

# Testing
scripts/test             # Run pytest with CLI smoke test
uv run pytest tests/test_specific.py -k test_name  # Run single test

# Linting/Formatting
scripts/fix              # Auto-fix: ruff check --fix, ruff format, oxfmt --write, oxlint --fix
scripts/pre-commit       # Check only: ruff check, ruff format --check, ty check, oxfmt --check, oxlint

# Run CLI locally
uv run human-review --help
```

## Architecture

### Python Package (`human_review/`)

- **cli.py** - Click-based CLI entry point. All commands (`start`, `status`, `diff`, `label`, `trust`, `approve`, etc.). Registered as `human-review` and `git-review` console scripts.
- **state.py** - `ReviewState` and `ReviewStateService` for persisting review progress. State stored in `human-review/reviews/` as JSON files (in git common dir for worktree support). Handles migrations from older state formats.
- **hunks.py** - Diff parsing: `parse_diff_to_hunks()`, `DiffHunk`, `ChangedFile`. Hunks identified by `filepath:hash` where hash is MD5 of content (first 8 chars).
- **git.py** - Git command wrappers (`git_diff`, `git_root`, `git_common_dir`, etc.)
- **skill.py** - Installs the skill to `~/.claude/skills/` via symlink
- **output.py** - Terminal styling helpers (colors, progress bars)

### Skill Definition (`human_review/skills/human-review/`)

- **SKILL.md** - Defines the `/human-review` Claude Code skill. Contains workflow instructions, classification guidelines, and example sessions.

### VS Code Extension (`vscode/`)

Separate TypeScript project with its own build system:

```bash
cd vscode
npm install
npm run build        # scripts/build
npm run package      # scripts/package - creates .vsix
```

Uses oxfmt for formatting and oxlint for linting. Extension provides UI for the review workflow.

## Key Concepts

- **Hunk**: A single block of changes in a diff, identified by `filepath:hash`
- **Reason**: Classification string assigned to hunks (e.g., `"renamed: src/old to src/new"`)
- **Trust**: Bulk-approve all hunks with a matching reason
- **Comparison**: The base..compare refs being reviewed (stored in `.git/human-review/current`)

## State Storage

Review state persists in `.git/human-review/reviews/<comparison>.json`. Storing inside `.git/` means state is automatically ignored by git and shared across worktrees. State includes:

- `hunks`: Dict mapping `filepath:hash` to `{label, approved_via}`
- `notes`: Free-form review notes
- `comparison`: Structured comparison info (old, new, working_tree)
