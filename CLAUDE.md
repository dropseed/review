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

- **Frontend**: React + TypeScript + Vite in `src/`, state managed with Zustand
- **Backend**: Rust + Tauri in `src-tauri/src/`, classification via Claude CLI (`claude` command)
- **Communication**: Frontend calls Rust via Tauri's `invoke()`, commands defined in `commands.rs`
- **Data flow**: Rust computes diffs/hunks → Zustand stores state → User actions invoke Rust → Rust persists to `.git/compare/`

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

## App Logs

Frontend logs are written to `.git/compare/app.log`. All `console.log`, `console.warn`, `console.error`, `console.info`, and `console.debug` calls are captured with timestamps and log levels:

```
[2026-01-26T12:00:00.000Z] [LOG] Message here
[2026-01-26T12:00:01.000Z] [ERROR] Error details
```

Claude can read this log file for debugging. The Debug modal (accessible in the app) shows current state; the log file shows historical activity.

## Claude Code Skills

When working on frontend code, use these skills:

- `/frontend-design` - For building UI components and interfaces with high design quality
- `/web-design-guidelines` - To review UI code for accessibility and best practices
- `/vercel-react-best-practices` - For React/Next.js performance patterns when writing or refactoring components

## Trust Patterns Taxonomy

Located in `src-tauri/src/trust/patterns.rs`. Pattern format is `category:label` (e.g., `imports:added`, `formatting:whitespace`). Categories: `imports`, `formatting`, `comments`, `types`, `file`, `code`, `rename`, `generated`, `version`, `remove`.
