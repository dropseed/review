# desktop/ui/ — Frontend (React + TypeScript + Vite)

## Claude Code Skills

When working on frontend code, use these skills:

- `/frontend-design` — For building UI components and interfaces with high design quality
- `/web-design-guidelines` — To review UI code for accessibility and best practices

## Conventions

- **Styling**: Tailwind CSS v4, utility classes with `tailwind-merge`
- **File naming**: kebab-case for utilities, PascalCase for React components
- **Components**: Feature-organized under `components/` (e.g., `FileViewer/`, `FilesPanel/`, `GuideView/`)
- **Hooks**: Custom hooks in `hooks/` for lifecycle concerns (file watching, keyboard nav, scroll tracking)

## Zustand Store

Single combined store in `stores/index.ts` via `useReviewStore` hook. State is split into 12 slices in `stores/slices/`:

| Slice | Purpose |
|---|---|
| `reviewSlice` | Review state: hunk approvals, trust labels, notes, save/load |
| `classificationSlice` | Claude/static classification of hunks |
| `navigationSlice` | Current file, hunk index, view mode |
| `filesSlice` | File tree, file content, hunks per file |
| `gitSlice` | Repo path, branches, comparison, git status |
| `preferencesSlice` | Font size, theme, sidebar width (persisted via Tauri Store) |
| `searchSlice` | Content search across files |
| `historySlice` | Undo/redo for review actions |
| `symbolsSlice` | Tree-sitter symbol extraction per file |
| `narrativeSlice` | AI-generated narrative summary |
| `undoSlice` | Undo stack for hunk approvals |
| `tabRailSlice` | Multi-tab/multi-review navigation |

Slices that need backend access receive an `ApiClient` via `SliceCreatorWithClient<T>`. Slices needing persistence receive a `StorageService` via `SliceCreatorWithStorage<T>`.

## UI Preferences

Stored globally via Tauri Store (persists across all repositories, stored in Tauri's app data directory):

- Font size, sidebar width, theme

## App Logs

Frontend logs are written to `~/.review/repos/<repo-id>/app.log` (use the `getReviewStoragePath` API to find the exact path for a given repo). All `console.log`, `console.warn`, `console.error`, `console.info`, and `console.debug` calls are captured with timestamps and log levels:

```
[2026-01-26T12:00:00.000Z] [LOG] Message here
[2026-01-26T12:00:01.000Z] [ERROR] Error details
```

Claude can read this log file for debugging. The Debug modal (accessible in the app) shows current state; the log file shows historical activity.

## API Layer

- `api/client.ts` — `ApiClient` interface (all backend operations)
- `api/tauri-client.ts` — Production implementation wrapping Tauri `invoke()` calls
- `api/http-client.ts` — Web/mobile implementation using HTTP (talks to companion server)
- `api/index.ts` — Factory that picks the right client based on environment

## Platform Abstraction

- `platform/types.ts` — `StorageService` interface
- `platform/tauri.ts` — Tauri Store implementation
- `platform/web.ts` — localStorage fallback
- `platform/index.ts` — Factory

## Components

Organized by feature area:

- `FileViewer/` — Diff view, code view, annotations, minimap, in-file search
- `FilesPanel/` — File tree sidebar, flat file list, commit panel
- `OverviewView/` — Summary stats, trust section, drill-down
- `ComparisonPicker/` — Comparison form sub-components (NewComparisonForm, BranchSelect)
- `TabRail/` — Tab navigation sidebar
- `ui/` — Shared primitives (dialog, popover, tooltip, tabs, etc.)

Top-level components: `ReviewView.tsx` (main review screen), `ComparisonPickerModal.tsx`, `SettingsModal.tsx`, `DebugModal.tsx`.

## Hooks

Custom hooks in `hooks/` handle lifecycle and cross-cutting concerns:

- `useComparisonLoader` — Loads comparison data when selection changes
- `useFileWatcher` — Starts/stops Tauri file system watcher
- `useKeyboardNavigation` — Keyboard shortcuts for file/hunk navigation
- `useScrollHunkTracking` — Tracks which hunk is visible during scroll
- `useGlobalShortcut` — Global OS-level shortcuts
- `useAutoUpdater` — App update checking
