# desktop/ui/ — Frontend (React + TypeScript + Vite)

## Conventions

- **Styling**: Tailwind CSS v4, utility classes with `tailwind-merge`
- **File naming**: kebab-case for utilities, PascalCase for React components
- **Components**: Feature-organized under `components/` (e.g., `FileViewer/`, `FilesPanel/`, `GuideView/`)
- **Hooks**: Custom hooks in `hooks/` for lifecycle concerns (file watching, keyboard nav, scroll tracking)

## Zustand Store

Single combined store in `stores/index.ts` via `useReviewStore` hook. State is split into 18 slices in `stores/slices/` — see `stores/types.ts` for the authoritative list. The ones you will touch most:

| Slice              | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `reviewSlice`      | Review state: hunk approvals, trust labels, notes, save/load |
| `navigationSlice`  | Current file, hunk index, view mode, search/palette overlays |
| `filesSlice`       | File tree, file content, hunks per file                      |
| `gitSlice`         | Repo path, branches, comparison, git status                  |
| `preferencesSlice` | Font size, theme, sidebar width (persisted via Tauri Store)  |
| `terminalSlice`    | Terminal panel, tabs, panes                                  |
| `tabRailSlice`     | Multi-tab/multi-review navigation                            |

Derived views over hunk state live in `stores/selectors/`. Note the split: `hunkData.ts` holds the plain functions and `hunks.ts` the hooks. Slices must import from `hunkData` — importing the hook module pulls in the assembled store, which imports the slices.

Slices that need backend access receive an `ApiClient` via `SliceCreatorWithClient<T>`. Slices needing persistence receive a `StorageService` via `SliceCreatorWithStorage<T>`.

## UI Preferences

Stored globally via Tauri Store (persists across all repositories, stored in Tauri's app data directory):

- Font size, theme, and split sizes (`tabRailWidth`, `filesPanelWidth`, `diffSplitFraction`)

Split sizes follow one rule, in `utils/resize.ts`: side panels are absolute (rem, so they track the UI scale) and clamped to the current window at render, while content splits are fractions. The _chosen_ size is what's persisted, so a width picked on a large display survives a stint on a laptop.

## App Logs

Frontend logs are written to `~/.review/app.log` (app-wide, not per-repo). All `console.log`, `console.warn`, `console.error`, `console.info`, and `console.debug` calls are captured with timestamps and log levels:

```
[2026-01-26T12:00:00.000Z] [LOG] Message here
[2026-01-26T12:00:01.000Z] [ERROR] Error details
```

Claude can read this log file for debugging. The Debug modal (accessible in the app) shows current state; the log file shows historical activity.

## React Scan Performance Log

In dev mode, React Scan render events are written to `~/.review/react-scan.jsonl` as JSONL (app-wide, not per-repo). Each line records a component render with timing, phase, and what changed. The log is cleared on app start. Logging is tied to React Scan's toolbar — pausing scanning pauses logging.

To analyze render performance, read the JSONL file and look for:

- Components with high `count` values (excessive re-renders)
- Components with `unnecessary: true` (rendered without meaningful changes)
- High `time` values (slow renders)
- Frequent `changes` on props/state that shouldn't be changing

## API Layer

- `api/client.ts` — `ApiClient` interface (all backend operations)
- `api/tauri-client.ts` — Production implementation wrapping Tauri `invoke()` calls
- `api/index.ts` — Factory that creates the API client

## Platform Abstraction

- `platform/types.ts` — `StorageService` interface
- `platform/tauri.ts` — Tauri Store implementation
- `platform/web.ts` — localStorage fallback
- `platform/index.ts` — Factory

## Commands and the palette

Every user-facing action is one `Command` in `commands/appCommands.ts`: title, category, keywords, an optional `Shortcut`, `isVisible`/`isEnabled` predicates, and a `run`. That single definition drives three consumers — the ⌘K palette lists it, `useCommandDispatch` binds its shortcut, and the native menu maps to it via `MENU_COMMANDS` in `hooks/useMenuEvents.ts`. `commands/menuParity.test.ts` fails the build if the Rust accelerators in `tauri/src/desktop/mod.rs` drift from the TypeScript.

Shortcuts are described by `KeyboardEvent.code`, never `key`: on macOS Option+C reports `key === "ç"`, so any Alt binding tested against `key` silently never fires.

Adding a command means adding one entry to `APP_COMMANDS`. Adding a _menu_ entry additionally means a `MenuItemBuilder` in `mod.rs` and a `MENU_COMMANDS` line.

`lib/fuzzy/` is the one fuzzy matcher — a Smith-Waterman DP producing scores normalized to 0..1, so several weighted fields and an extrinsic boost can be blended without one term swamping the others. `components/palette/PaletteDialog.tsx` is the shell behind the palette and all three finders; it owns the combobox ARIA contract and the flat-index ↔ grouped-render mapping.

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
