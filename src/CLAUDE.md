# src/ — Frontend (React + TypeScript + Vite)

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

## API Layer

- `api/client.ts` — `ApiClient` interface (all backend operations)
- `api/tauri-client.ts` — Production implementation wrapping Tauri `invoke()` calls
- `api/http-client.ts` — Debug/web implementation using HTTP (talks to debug server)
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
- `StartScreen/` — Repo picker, comparison form, saved reviews
- `TabRail/` — Tab navigation sidebar
- `ui/` — Shared primitives (dialog, popover, tooltip, tabs, etc.)

Top-level components: `ReviewView.tsx` (main review screen), `WelcomePage.tsx`, `SettingsModal.tsx`, `DebugModal.tsx`.

## Hooks

Custom hooks in `hooks/` handle lifecycle and cross-cutting concerns:

- `useComparisonLoader` — Loads comparison data when selection changes
- `useFileWatcher` — Starts/stops Tauri file system watcher
- `useKeyboardNavigation` — Keyboard shortcuts for file/hunk navigation
- `useScrollHunkTracking` — Tracks which hunk is visible during scroll
- `useGlobalShortcut` — Global OS-level shortcuts
- `useAutoUpdater` — App update checking
