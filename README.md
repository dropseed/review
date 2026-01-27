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

```mermaid
graph TB
    subgraph Frontend["Frontend (src/)"]
        React["React + TypeScript + Vite"]
        subgraph Zustand["Zustand Store"]
            gitSlice["gitSlice"]
            filesSlice["filesSlice"]
            reviewSlice["reviewSlice"]
            classificationSlice["classificationSlice"]
            navigationSlice["navigationSlice"]
            preferencesSlice["preferencesSlice"]
        end
        React --> Zustand
    end

    subgraph Desktop["Desktop (src-tauri/)"]
        commands["commands.rs"]
        watchers["watchers.rs"]
        debug_server["debug_server.rs"]
    end

    subgraph Core["Core Library (compare/)"]
        sources["sources/
        DiffSource trait
        LocalGitSource"]
        diff["diff/
        parser"]
        review["review/
        state, storage"]
        trust["trust/
        patterns, matching"]
        classify["classify/
        Claude API"]
        cli["cli/ (feature-gated)
        compare-cli, git-compare"]
    end

    subgraph Storage["Storage"]
        git_compare[".git/compare/
        reviews/*.json
        custom-patterns.json"]
        tauri_store["Tauri Store
        (UI preferences)"]
    end

    React -->|"invoke()"| commands
    commands --> sources
    commands --> diff
    commands --> review
    commands --> trust
    commands --> classify
    watchers -->|"file system events"| React

    sources -->|"git operations"| diff
    diff -->|"hunks"| review
    trust -->|"pattern matching"| review
    classify -->|"Claude API"| trust

    review --> git_compare
    preferencesSlice --> tauri_store
```

- **Frontend**: React + TypeScript + Vite (`src/`), state managed with Zustand
- **Backend**: Rust + Tauri (`src-tauri/`), classification via Claude CLI

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
