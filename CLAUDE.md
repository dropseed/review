# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Compare is a desktop app (built with Tauri) that helps humans review diffs more efficiently. It classifies hunks (individual change blocks), enables bulk-approval of trivial changes, and focuses attention on what needs careful human review. It is **not** an AI code reviewer—it assists the review process.

## Development Commands

```bash
# Setup
scripts/install          # Install dependencies (npm + cargo + pre-commit hook)

# Desktop Development
scripts/dev              # Run in development mode with hot reload

# Mobile Development
scripts/mobile           # Start Expo dev server for iOS app
scripts/mobile ios       # Start and open iOS simulator
scripts/mobile clear     # Clear cache and start fresh
scripts/mobile-build     # Build development client for simulator
scripts/mobile-check     # Type check the mobile app

# Testing
scripts/test             # TypeScript type check + Rust tests
scripts/test-sync        # E2E test for sync server API

# Linting/Formatting
scripts/fix              # Auto-fix: prettier + cargo fmt
scripts/pre-commit       # Check only: prettier --check + cargo fmt --check

# Build
scripts/build            # Build production app (outputs to target/release/)
```

## Architecture

The project is organized as a Cargo workspace with two crates:

- **`compare/`** - Core library + CLI (no Tauri dependencies)
  - `src/classify/` - Claude-based hunk classification
  - `src/diff/` - Git diff parsing and hunk extraction
  - `src/review/` - Review state management and persistence
  - `src/sources/` - Git operations abstraction
  - `src/trust/` - Trust pattern matching and taxonomy
  - `src/cli/` - CLI commands (behind `cli` feature flag)
  - `src/bin/` - CLI binaries (`compare-cli`, `git-compare`)

- **`src-tauri/`** - Desktop app (depends on `compare`)
  - `src/desktop/` - Tauri-specific code (commands, watchers, debug server)

- **Desktop Frontend**: React + TypeScript + Vite in `src/`, state managed with Zustand
- **Mobile App**: Expo + React Native in `mobile/`, state managed with Zustand
- **Communication**: Frontend calls Rust via Tauri's `invoke()`, commands defined in `desktop/commands.rs`
- **Data flow**: Rust computes diffs/hunks → Zustand stores state → User actions invoke Rust → Rust persists to `.git/compare/`

### Mobile App (`mobile/`)

The iOS companion app syncs with the desktop app over the network:

- **`app/`** - Expo Router screens (file-based routing)
- **`components/`** - React Native components (HunkCard, SwipeableHunk, CodeBlock)
- **`stores/`** - Zustand slices (connection-slice, sync-slice)
- **`api/`** - Sync client for HTTP/WebSocket communication
- **`theme/`** - Design system (colors, typography, spacing)

### Sync Server (`src-tauri/src/desktop/server.rs`)

HTTP/WebSocket server for mobile connectivity:

- **Port**: 17950 (default)
- **Auth**: Bearer token authentication
- **API Endpoints**: `/api/repos`, `/api/state`, `/api/diff`, `/api/events` (WebSocket)
- **Design**: Works over Tailscale VPN for secure remote access

## Key Concepts

- **Hunk**: A single block of changes in a diff, identified by `filepath:hash`
- **Trust Pattern**: Label from the taxonomy (e.g., `imports:added`, `formatting:whitespace`)
- **Trust List**: Patterns the user has chosen to auto-approve
- **Comparison**: The base..compare refs being reviewed

## State Storage

Compare uses two storage mechanisms:

**UI Preferences** (global, via Tauri Store):

- Font size, sidebar width, theme
- Persists across all repositories
- Stored in Tauri's app data directory

**Review State** (per-repo, in `.git/compare/`):

- `reviews/<comparison>.json` - Hunk labels, approvals, notes
- `current-comparison.json` - Last active comparison
- `custom-patterns.json` - Optional user-defined trust patterns

Storing review state inside `.git/` means it's automatically ignored by git and shared across worktrees. Review state includes:

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

The taxonomy is defined in `compare/resources/taxonomy.json` and loaded at runtime. Pattern format is `category:label` (e.g., `imports:added`, `formatting:whitespace`). Categories: `imports`, `formatting`, `comments`, `types`, `file`, `code`, `rename`, `generated`, `version`, `remove`.

Users can extend the taxonomy by creating `.git/compare/custom-patterns.json` with the same JSON structure. Custom patterns are merged with the bundled taxonomy at runtime.
