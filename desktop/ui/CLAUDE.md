# desktop/ui/ — Frontend (React + TypeScript + Vite)

## Conventions

- **Styling**: Tailwind CSS v4, utility classes with `tailwind-merge`
- **File naming**: kebab-case for utilities, PascalCase for React components
- **Components**: Feature-organized under `components/` (e.g., `FileViewer/`, `FilesPanel/`, `GuideView/`)
- **Hooks**: Custom hooks in `hooks/` for lifecycle concerns (file watching, keyboard nav, scroll tracking)

## Zustand Store

Single combined store in `stores/index.ts` via `useReviewStore` hook. State is split into 19 slices in `stores/slices/` — see `stores/types.ts` for the authoritative list. The ones you will touch most:

| Slice              | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `reviewSlice`      | Review state: hunk approvals, trust labels, notes, save/load |
| `navigationSlice`  | Current file, hunk index, view mode                          |
| `overlaySlice`     | The one open overlay, and the palette's mode                 |
| `filesSlice`       | File tree, file content, hunks per file                      |
| `gitSlice`         | Repo path, branches, comparison, git status                  |
| `preferencesSlice` | Font size, theme, sidebar width (persisted via Tauri Store)  |
| `terminalSlice`    | Terminal panel, tabs, panes; sessions carry their workspace  |
| `tabRailSlice`     | Multi-tab/multi-review navigation                            |
| `workspaceSlice`   | The workspace queue: load, optimistic reorder, and the focus |

Derived views over hunk state live in `stores/selectors/`. Note the split: `hunkData.ts` holds the plain functions and `hunks.ts` the hooks. Slices must import from `hunkData` — importing the hook module pulls in the assembled store, which imports the slices.

### A file-watcher event patches, it does not reload

A working-tree edit names the paths it touched, so the diff is recomputed for
those files only: `getFilesDelta` returns their current hunks plus each path's
place in the comparison, and `stores/filesDelta.ts` folds that into
`filesByPath` and the file tree, preserving the object identity of every file
the edit didn't touch. What follows is scoped to the same paths — only genuinely
new hunk ids are classified, and reconciliation is handed just those files
(decisions whose hunks aren't in the set are retained, not dropped). Move
detection is the exception: a move is a cross-file fact, so it re-runs over the
whole comparison, but deferred behind a debounce and asked for by comparison
rather than by shipping every hunk across the boundary.

Incremental is an optimization, never a different answer. `gitStateChanged`
(commit, branch switch, stage), a batch above `MAX_INCREMENTAL_PATHS`, or any
failure goes to the full `refresh()`.

## The workspace is the only navigation axis

The app is a queue of workspaces and a stage showing one of them. A workspace is a container that becomes what you put in it: a nullable `title`, a `displayTitle` the backend derives when there is none, and an ordered list of **attachments** (`{path, refName}`) which are the code half's repo tabs. Nothing about an attachment is exclusive — any number of workspaces may show the same repo — and `refName` is a view hint, never identity: the tab is the _path_.

`useFocusedWorkspace` (`stores/selectors/workspaces.ts`) is what both halves read: an explicit `focusedWorkspaceId` wins, and with none the focus is _derived_ from whichever workspace is showing the repo on screen — so a deep link, the CLI, and ⌘K all land inside a workspace without a second gesture. Matching is by repo rather than by ref, so walking a repo's branches never leaves its tab. `focusWorkspace` in `commands/workspaceCommands.ts` is the one way in; it sets the focus, opens the first repo tab (or goes to the workspace's empty state when there is none to open), and selects that workspace's terminal tab.

The stage is **two tab strips**, drawn to match: terminals on the left (`TerminalPanel`), repos on the right (`Stage/CodeHalfHeader`), each with its own `+` and its own `Stage/FocusToggle`. The toggle is `split ⇄ this half` against the one `contentFocus` state (`"split" | "terminal" | "code"`, persisted by `terminalSlice`, also driven by the `view.toggleTerminal` and `view.maximizeTerminal` commands); the two bars are never both hidden, so the button that took the stage is always the one on screen to give it back, and neither collapsed rail (`Terminal/TerminalRail`, `ContentArea/DiffRail`) carries a second copy of it. `useTerminalDockPresent` is the one answer to "is the stage actually split", shared by the dock and the repo bar so a Focus button never appears with nothing to take the room from. The repo strip's `+` is a `RepoPicker` popover over the sidebar tree's repos; picking calls `work_attach`, closing a tab calls `work_detach` and hands the screen to the neighbour. The Review/Git/Browse strip belongs to the files panel it switches and is drawn as that panel's own first row — it used to be portalled up into `CodeHalfHeader`, which is why that header now holds repo tabs and nothing else. A workspace showing no repo and running nothing gets `Stage/EmptyStage` — the same two-column frame, each half centring one block: `Terminal/StartTerminal` (the same block the terminal panel shows when it has no tabs) and the repo picker. The sidebar header's `+` creates a workspace outright (`work_add` with a null title and no attachments) and focuses it; there is no dialog and no create flow.

`autoCreated` is backend plumbing for cleanup. It is never rendered and nothing branches on it — a router-made workspace and a human-made one are the same thing on screen.

Slices that need backend access receive an `ApiClient` via `SliceCreatorWithClient<T>`. Slices needing persistence receive a `StorageService` via `SliceCreatorWithStorage<T>`.

## UI Preferences

Stored globally via Tauri Store (persists across all repositories, stored in Tauri's app data directory):

- Font size, theme, and split sizes (`tabRailWidth`, `filesPanelWidth`, `diffSplitFraction`)
- `workspaceSeenAt` — when each workspace was last focused, epoch ms

`workspaceSeenAt` is what makes an attention signal _unseen_. `attentionSignalAt` (in `Sidebar/workspace-status`) is the newest moment a workspace did something that wants a person — a terminal stopped and waiting, a PR asking for changes or failing CI, a merge — and `isUnseen` compares it against that entry. A card carrying an unseen signal wears an accent bar on its outer edge; `focusWorkspace` writes the timestamp, so **looking at it is the acknowledgement** and there is no dismiss gesture. It lives in preferences and never in `work.json`: this is a fact about one pair of eyes, not about the work, and a second machine reasonably has its own answer.

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

Adding a command means adding one entry to `APP_COMMANDS` — or to `TERMINAL_COMMANDS` in `components/Terminal/commands.ts` for the ones the terminal owns, which the menu-parity test also reads. Adding a _menu_ entry additionally means a `MenuItemBuilder` in `mod.rs` and a `MENU_COMMANDS` line.

**⌘T is `terminal.new`**: a terminal in the focused workspace, from anywhere, with no dialog ever. It is `openTerminalTab(focusedWorkspace(...))` and nothing else — the cwd follows the repo tab on screen (its first tab otherwise), and with no workspace focused, or one showing no repo, it names no directory at all, so the backend starts in `$HOME` and the router places the session by cwd exactly as it would a shell started outside the app. ⌘T used to open an app tab unless a terminal pane happened to hold DOM focus; app tabs are ⇧⌘T now.

`lib/fuzzy/` is the one fuzzy matcher — a Smith-Waterman DP producing scores normalized to 0..1, so several weighted fields and an extrinsic boost can be blended without one term swamping the others.

### The palette's five modes

⌘K, ⌘P and ⌘R are one dialog, not three. `activeOverlay === "palette"` plus a `PaletteMode` (`go` / `files` / `commands` / `symbols` / `content`) is the whole state; each shortcut calls `openPalette(mode)`. Prefixes switch modes in place — `/` files, `>` commands, `@` symbols, `#` in files, nothing for `go` — and Backspace on an empty query steps back, falling to `go` when there is nothing to unwind. See `components/palette/modes.ts` for why a prefix is only read out of an _empty_ box.

`go` is where ⌘K lands and the app's only navigation surface: workspaces, every branch the sidebar tree knows, and every running terminal. It navigates and nothing else — creating a workspace is the sidebar's `+`, and opening a repo in one is the repo strip's. A branch row carries the **router preview** — "→ joins <workspace>" or "→ new workspace" — decided by `previewRouteIn` (`stores/selectors/workspaceData.ts`) against the attachments already in the store rather than reading the queue off disk per keystroke; `route-preview.ts` only supplies the wording. It mirrors the backend's heuristic: the first workspace in queue order showing that repo, else a new one. A wrong guess is cheap — nothing was taken from anyone, and the terminal can be dragged. Branch and terminal rows are capped at `MAX_RESULTS`; workspaces never are.

Rows have a second verb on **⌘Enter** (`onAlternateActivate` / `alternateLabel` on the dialog): the same destination, plus a terminal started there. Both verbs go through one `goTo` in `sources/go.tsx`, so ⌘Enter commits the same routing decision the preview promised — and the shell lands on the branch the row named, not on whichever repo the workspace lists first. A running-terminal row has nothing to add, so ⌘Enter there just jumps.

`content` is the mode with no shortcut of its own: ⌘⇧F opens the full results view in the content area (`components/search/`) instead, because a match is a line and a dropdown row truncates it. The mode stays reachable at `#` as the way to jump to a hit without leaving the diff, and both front doors drive the same `searchSlice`.

Three files divide the work:

- `PaletteDialog.tsx` — the shell. Owns the combobox ARIA contract and the flat-index ↔ grouped-render mapping, so a grouped mode cannot open a different row than the one highlighted.
- `sources/*.tsx` — one hook per mode, each returning a `PaletteSource` (the half of the dialog's props that depends on what is being searched). Every hook runs on every render, so each takes `active` and declines its own work; the fetches and tree walks all sit behind it.
- `Palette.tsx` — routes between them. Modes swap the contents of a dialog that stays mounted, because four Radix roots would replay the open animation and drop focus on every prefix keystroke.

Adding a mode means a `modes.ts` entry and a `sources/` hook. Nothing else changes.

## Components

Organized by feature area:

- `FileViewer/` — Diff view, code view, annotations, minimap, in-file search
- `FilesPanel/` — The code half's files column: mode strip, file tree, flat file list, commit panel. The one place per-file review status is reported
- `ContentArea/` — What the code half shows: the file viewer(s), the multi-file stacks, and the "select a file" state. There is no overview screen — a summary that restated the files column beside it was the app saying everything twice
- `GuideView/` — The guide's multi-file diff stack and the trust section
- `ComparisonPicker/` — Comparison form sub-components (NewComparisonForm, BranchSelect)
- `Sidebar/` — The chrome sidebar: the workspace queue, its two densities, and the shared verbs (`workspace-actions`, `workspace-drag`, `workspace-status`)
- `Stage/` — The focused workspace's frame: the code half's repo tab strip, the repo picker, and the empty state. Nothing sits above the two halves — the sidebar card is where a workspace's identity, status and progress are read
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
