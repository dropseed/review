# PullApprove Review

A desktop app for reviewing code diffs with trust patterns and annotation support.

## Development

### Prerequisites

- Node.js 18+
- Rust (latest stable)
- Tauri CLI: `cargo install tauri-cli`

### Setup

```bash
cd pullapprove-review
npm install
```

### Run in development

```bash
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

## Architecture

### Frontend (React + TypeScript)

- `src/components/` - React components
  - `FileTree` - Full repository file browser with change indicators
  - `CodeViewer` - Code display with diff highlighting
  - `ComparisonSelector` - Pick what to compare (working/staged/branch)
  - `ReviewPanel` - Trust patterns, notes, progress
- `src/stores/` - Zustand state management
- `src/types/` - TypeScript type definitions

### Backend (Rust + Tauri)

- `src-tauri/src/sources/` - Diff source abstraction
  - `traits.rs` - DiffSource trait for extensibility
  - `local_git.rs` - Local git repository implementation
- `src-tauri/src/diff/` - Diff parsing
- `src-tauri/src/review/` - Review state management
- `src-tauri/src/trust/` - Trust pattern taxonomy and matching

## Key Concepts

- **Comparison** - What you're reviewing (working changes, staged, branch diff)
- **Hunk** - A block of changes, identified by `filepath:hash`
- **Trust Pattern** - A label like `imports:added` that can auto-approve hunks
- **Review State** - Persisted in `.git/pullapprove-review/reviews/`

## Extending

The `DiffSource` trait abstracts over the source of diffs. Currently implemented:

- `LocalGitSource` - Local git repositories

Future implementations could include:
- `GitHubSource` - GitHub API for PRs
- `GitLabSource` - GitLab API for MRs
