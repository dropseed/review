# Compare

A desktop app for reviewing code diffs with trust patterns and annotation support.

## Development

### Prerequisites

- Node.js 18+
- Rust (latest stable)

### Setup

```bash
scripts/install
```

### Commands

```bash
scripts/install          # Install dependencies (npm + cargo + pre-commit hook)
scripts/dev              # Run in development mode with hot reload
scripts/test             # TypeScript type check + Rust tests
scripts/fix              # Auto-fix: prettier + cargo fmt
scripts/build            # Build production app
```

## Architecture

### Frontend (React + TypeScript)

- `src/components/` - React components
  - `FileTree.tsx` - Full repository file browser with change indicators
  - `CodeViewer.tsx` - Code display with diff highlighting
  - `ComparisonSelector.tsx` - Pick what to compare (working/staged/branch)
  - `ReviewFilePanel.tsx` - Review panel for individual files
  - `TrustPatternsPanel.tsx` - Trust patterns management
- `src/stores/` - Zustand state management
- `src/types/` - TypeScript type definitions

### Backend (Rust + Tauri)

- `src-tauri/src/sources/` - Diff source abstraction
  - `traits.rs` - DiffSource trait for extensibility
  - `local_git.rs` - Local git repository implementation
- `src-tauri/src/diff/` - Diff parsing
- `src-tauri/src/review/` - Review state management
- `src-tauri/src/trust/` - Trust pattern taxonomy and matching
- `src-tauri/src/classify/` - Claude classification integration

## Key Concepts

- **Comparison** - What you're reviewing (working changes, staged, branch diff)
- **Hunk** - A block of changes, identified by `filepath:hash`
- **Trust Pattern** - A label like `imports:added` that can auto-approve hunks
- **Review State** - Persisted in `.git/compare/reviews/`

## Extending

The `DiffSource` trait abstracts over the source of diffs. Currently implemented:

- `LocalGitSource` - Local git repositories

Future implementations could include:

- `GitHubSource` - GitHub API for PRs
- `GitLabSource` - GitLab API for MRs
