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

`useFocusedWorkspace` (`stores/selectors/workspaces.ts`) is what both halves read: an explicit `focusedWorkspaceId` wins, and with none the focus is _derived_ from whichever workspace is showing the repo on screen — so a deep link, the CLI, and ⌘K all land inside a workspace without a second gesture. "The repo on screen" is `repoOnScreen`, not the comparison's repo: browse and standalone mode open a path and no comparison at all, and a folder being read is still a tab someone is in. Matching is by repo rather than by ref, so walking a repo's branches never leaves its tab. `focusWorkspace` in `commands/workspaceCommands.ts` is the one way in; it sets the focus, opens the first repo tab (or goes to the workspace's empty state when there is none to open), and selects that workspace's terminal tab.

**A tab is a path, so a path always opens.** `targetForAttachment` resolves an attachment to a `ReviewTarget`, and the ref it returns is either a branch or `CHECKOUT_REF` (the empty string) — which means "show what is there", and is what `activateReviewTarget` hands to the command host's `openPath` instead of a comparison. Three attachments take that route: a plain directory (`isGitRepo: false` on the wire), a repo the sidebar tree has no node for (a `git init` from a minute ago has no commit to build a row out of), and a repo picked without a branch. `openPath` asks git which of those it is — live, because `isGitRepo` is a snapshot from the last queue read — and lands in browse mode or the standalone reader. Neither leaves the workspace: both set `repoPath` to the path the attachment names, which is what `repoOnScreen` derives from. The one attachment that still opens **nothing** is a tab naming a branch nothing here has, which is the case the sidebar-row gate was always about: a diff of something that isn't there is worse than an empty state.

**Three verbs land in a workspace**, all in `commands/workspaceCommands.ts`, and every one of them is `takeFocus` plus an ending. `focusWorkspace` points the stage at one you already have, opening a comparison after. `openRowInWorkspace` is ⌘K's Enter and the PR drawer's click — route by the row's branch, open by the row's key. `landWorkspace` is everything arriving from *outside* the app — the CLI, the `review://` deep link, Finder's "Open with", the URL, the launch directory, a page refresh — and it takes the focus and **not** the screen, because its callers own the comparison. It must be called before they open it; the reasoning for both halves is at the three `land*` wrappers in `hooks/useRepositoryInit.ts`, which is where every one of those callers goes through. Nothing may reach `openBrowseMode` or `enterStandaloneMode` without landing first except `openPath`, which serves tab clicks that are already in a workspace.

The standalone reader is a degraded view, not a mode of its own — `isStandaloneFile` and the `/standalone/browse` route are the ones the CLI already used. The files panel needs no branch for it: with no comparison, Review is withheld and Git greys out already, and the only addition is that it says _why_ ("This folder isn't a git repository") rather than inviting someone to check something out.

Derivation is why a **relaunch** needs one thing of its own. Everything a workspace is made of survives on disk — the queue, the daemon's sessions, the review state — but the focus is derived from the comparison on screen, and a cold start has no comparison to derive it from: the app came up with a repo tab bar holding no tabs and a terminal strip showing none of the shells still running, until you switched to another workspace and back. `hooks/useWorkspaceRestore.ts` closes that: it remembers the workspace on screen (as `lastWorkspaceId`, a preference) and reads it back once on launch. It is deliberately timid — anything that reaches the stage first wins outright, and a stage the launch already claimed (a comparison, or a repo in browse or standalone mode, from a URL, a `review` invocation, or the launch directory) keeps the screen it asked for while the restore takes only the focus back; a repo the person closed stays closed. `hooks/workspace-restore.ts` holds the decision as a pure function, because the whole question is which of the queue, the sidebar's rows and the repo init has landed yet; the restore waits for the rows before opening a tab, bounded, since "still loading" and "that branch is gone" look identical from there.

The stage is **two tab strips**, drawn to match: terminals on the left (`TerminalPanel`), repos on the right (`Stage/CodeHalfHeader`), each with its own `+` and its own `Stage/FocusToggle`. The toggle is `split ⇄ this half` against the one `contentFocus` state (`"split" | "terminal" | "code"`, persisted by `terminalSlice`, also driven by the `view.toggleTerminal` and `view.maximizeTerminal` commands); the two bars are never both hidden, so the button that took the stage is always the one on screen to give it back, and neither collapsed rail (`Terminal/TerminalRail`, `ContentArea/DiffRail`) carries a second copy of it. Each toggle is revealed by hovering its own bar (which carries `group/bar`) — with two exceptions that keep it from being a control you have to already know about: it stays visible while focused, because a half holding the whole stage must always show the way back, and it appears on keyboard focus. `useTerminalDockPresent` is the one answer to "is the stage actually split", shared by the dock and the repo bar so a Focus button never appears with nothing to take the room from. The repo strip's `+` is a `RepoPicker` popover over the sidebar tree's repos; picking calls `work_attach`, closing a tab calls `work_detach` and hands the screen to the neighbour. The Review/Git/Browse strip belongs to the files panel it switches and is drawn as that panel's own first row — it used to be portalled up into `CodeHalfHeader`, which is why that header now holds repo tabs and nothing else. A workspace showing no repo and running nothing gets `Stage/EmptyStage` — the same two-column frame, each half centring one block: `Terminal/StartTerminal` (the same block the terminal panel shows when it has no tabs) and the repo picker. The picker's list is every checkout the app already knows about, so its last row is the one gesture it cannot list — **"Open folder…"**, the native directory dialog, which hands back an ordinary `RepoChoice` so both front doors open it exactly as they open a row. It refuses nothing: a repo with no commits and a directory that never was one both open now. ⌘O (`app.openRepo`) is that same verb by keystroke, against the focused workspace or a fresh one — it used to validate the pick as a git repo and land in a browse mode outside the workspace model, which made the app's oldest shortcut the one gesture producing a screen no card stood for. `openBrowseMode` stays for its remaining callers, the URL and CLI init paths. The sidebar header's `+` and ⌘N are the same verb, `newWorkspace` in `commands/workspaceCommands.ts`: `work_add` with a null title and no attachments, focused; there is no dialog and no create flow. This app is one window — macOS window tabs and multi-window are both gone, so ⌘N makes a workspace instead of another copy of the app.

Workspaces **nest**: `parentId` puts one under another, to any depth, and the
backend keeps `workspaces` a flat array in tree order — each entry followed by
its own subtree — so every list here goes on being a list. The tree shows up as
`depth` (what a card indents by, capped for drawing in `Sidebar/row-chrome`) and
`ancestors` (the named chain, which is what the palette and the collapsed rail
show, since neither has an indent to carry it). Dragging a card onto another
nests it; dragging into a gap positions it and lands it at the depth of the row
it displaces, which is what `gapDepth` draws the insertion line at. The store's
`reorderWorkspaces` mirrors that rule — and `retree` mirrors the backend's
derivation of `depth`/`ancestors` — so a dragged card is drawn at its new indent
in the frame it lands rather than a round trip later. Menu moves pass
`keepParent` instead and take the plain non-optimistic path: their settling rule
is the backend's `reflow`, and a second copy of that here would buy a frame and
cost a source of truth.

`autoCreated` is backend plumbing for cleanup. It is never rendered and nothing branches on it — a router-made workspace and a human-made one are the same thing on screen.

The _other_ half of cleanup is an event: closing a workspace's last terminal drops the workspace too, when it has no typed title and at most one attachment. `reapSpentWorkspace` in `components/Terminal/close.ts` holds the rule and the argument for why it is an event rather than a sweep.

## The viewpoint is the comparison

The code half shows one `base..head` at a time, and every list in the files
panel is a function of it: Review is the diff, Browse is the tree at `head`,
and Git is the working tree — applicable exactly when `head` is checked out
(`isCheckedOut` in `stores/selectors/checkout.ts`, mirroring core's
`working_tree_dir`: the branch checked out here, or the linked worktree this
review owns). The working tree is not a special place; it is what core diffs
against when the head is checked out, which is also why `head..head` reads as
"uncommitted".

Two comparisons, one on screen. `reviewComparison` is the review's own
`base..head` — the persisted identity, keyed by `reviewRef`. `comparison` is
the plumbing every data call diffs, and it is _derived_ from `viewpoint`
(`types/viewpoint.ts`): `review` means the two are the same; `range` narrows to
a `CommitRange` within the review, a re-diff of `prev..commit` with the review
state still attached (decisions land on the branch's hunks — never a second
approval surface); `commit` is a peek at a commit the review isn't of, and
`reviewState` is null for its whole duration, which is the one gate that keeps a
look from writing anything. `setViewpoint` is the only writer.

`FilesPanel/ComparisonBar` is the one control, above the tab strip: the head on
top, "vs base · slice · N commits" underneath, tinted whenever the head isn't
checked out, and a menu whose every row is a comparison with both ends named —
the whole slice, uncommitted, unpushed, this branch's commits (a narrowing;
shift-click a range), older history (a peek), change base. A commit reaches the
screen by one rule wherever it was clicked: on the branch it narrows, off it it
peeks. Git greys out rather than disappearing when the head isn't checked out,
so the tab row holds still and the tooltip says why. Browse has no picker of
its own; it reads at the head on screen, fetched only while Browse is open
(`activeHistoricRef`).

## Phone width is a degraded desktop, never a mode

`useIsCompact()` (below Tailwind's `md`, so a JS branch and an `md:` class flip on the same pixel) is the one answer to "is this a phone". Everything reading it **degrades and writes nothing back** — the rule `useResponsiveDiffViewMode` already follows for a split diff in a narrow pane — so a stored preference survives a phone visit untouched and returns intact when the window widens.

It is split by what CSS can reach. Structure is JS, because the widths come from `style` props and a `ResizeObserver` and because "a drawer instead of a column" is a different tree, not a different style; pure styling stays in `md:` classes. Four places branch:

- **The stage** becomes a navigation stack (`Stage/CompactStage`, reached from `TerminalDock`'s compact branch) with the terminal at the bottom of it — see "The phone's stage is a stack" below. Both halves stay mounted throughout, for the reason `contentRail` keeps the content mounted.
- **The sidebar** becomes `Sidebar/QueueDrawer` — the same component with `drawer`, over the stage. Its open state is the shell's `useState`, deliberately **not** `tabRailCollapsed`: that one is persisted, and a phone must not open into whatever a laptop last chose.
- **The code half** is list-or-detail, derived from `selectedFile` alone. `filesPanelCollapsed` is the obvious lever and the wrong one — a persisted desktop preference a thumb must not edit.
- **A terminal pane** becomes a viewer: it draws the PTY's true grid scaled to fit and never resizes it (see "One PTY grid" in the root CLAUDE.md). The PTY's size is the degraded-desktop rule applied to a resource _shared with other machines_ — a phone visit must not reflow the session under the desktop that is sized to it. The two writes are both taps and both deliberate: "Fit to screen", and the text-size steps (`Terminal/TerminalOverflowSheet`, committed through `TerminalTextSize`'s `applyTerminalFontSize` — the same function the end of a pinch calls), which are a fit and have to be — a bigger font on the same grid is drawn at a smaller scale and arrives the size it left, so bigger text means fewer columns. Both ask the mounted pane through `registry`'s `requestFit`, because taking the drawing's transform off to measure and putting it back is pane-local work — which is also why `refreshAllTerminalOptions` leaves a viewer rescaled rather than refitted, and why these two are the stated exception rather than a second rule.

  The fit has **two front doors and neither floats over the terminal**. The sheet's row is the unconditional one, labelled in words. The other is `Terminal/TerminalScaleChip` in the strip's trailing group: the scale as a percentage, shown only below `view-scale`'s threshold, tapping to fit — a status readout that happens to be a control, and its disappearing is what says the fit worked. It was a pill in the corner of the drawing, which sat on the last rows of output (over Claude Code, exactly on its status line); a control that covers the thing it is about is the wrong trade at any size. The scale gets there through `registry`'s `setTerminalViewScale`/`onTerminalViewScale`, which live *beside* the registry map rather than in an entry, because the strip mounts before the pane has acquired anything and a listener keyed on an entry that doesn't exist yet never fires.

  The one thing that does still float over a pane is `new-output`'s "↓ New output" — and only while the reader is deliberately away from the tail, so what it covers is old output and reaching the bottom takes it away. Three facts decide it (`viewportY` vs `baseY`, `onWriteParsed`, `onBufferChange`) and the alternate screen never shows it: a full-screen program has no scrollback to be away from and its repaints are not news.

  A touch is not a mouse, and @xterm/xterm 6.0.0 answers almost none of it, so four things are ours (`Terminal/TerminalPane`, with the buffer work in `Terminal/registry`). **Selection**: xterm's canvas can't grow iOS selection handles and its own hit-testing is wrong under a CSS scale, so a long-press swaps in `Terminal/TerminalSelectionOverlay` — the visible rows of the buffer as real DOM text at the drawing's exact transform, the pressed word pre-selected, copy normalized by `selection-text` — and a `pointerdown` anywhere that drops the selection takes it away again. **Scrolling**: xterm ships its Gesture machinery unattached and the scrollback viewport is a _sibling_ of the screen a finger lands on, so nothing scrolls at all — a drag is measured in rows and carried like a wheel notch (`scrollByDrag`), and on the alternate screen it sends cursor keys, which is what xterm does with a wheel over a full-screen TUI. **Links**: xterm hit-tests a click by dividing the element's scaled rect by unscaled cell metrics, so on a scaled pane every tap resolves left of and above the link under the thumb — `openLinkAt` takes a fraction of the drawing instead and reads the buffer, rejoining wrapped rows (bounded, since one logical line can be the whole scrollback). Which URL is under the offset is `utils/urlInText`, shared with the diff's ⌘-click so one link cannot open two pages depending on where it was read. **The keys a software keyboard doesn't have** — `Terminal/SoftKeys`, a row in the panel rather than a keyboard accessory, because Esc and the arrows are most wanted while _reading_ with no keyboard up. It sends key _names_ through `registry`'s `sendKey`, which encodes them the way every hardware keystroke is encoded (`kitty-keys`): a program that negotiated the kitty protocol reads `CSI 27 u` for Escape and ignores a bare `\x1b`, so a bar with its own escapes would fail in exactly the sessions it matters most in. Control is armed in `Terminal/soft-keys` and consumed in `registry`'s `sendChar` — the one door a typed character leaves by, whether it arrived at the pane's `onData` or at the compose box that has focus instead — since the key it modifies comes from the system keyboard. iOS leaves the layout full-height with its keyboard up, so `useKeyboardInset` publishes what the keyboard covers as `--keyboard-inset` (a custom property, not React state — it changes through the whole open animation) and the shell subtracts it.

  This one bullet is the exception to `useIsCompact` being the only question: the key row is gated on `useIsTouchPrimary` (`(pointer: coarse) and (hover: none)`) instead, because "there is no Escape key on this device" is a fact about what the person is holding, not about how wide the window is — an iPad in landscape is wide and still has none. The text-size steps stay a width question; the pane's touch listeners are unconditional, being inert without touches.

## The phone's stage is a stack

There is no bottom tab bar. A phone opens this app because something is running in a terminal, so the terminal **is** the screen, and the code half is one you *push* onto it — `Stage/CompactStage`, with the arithmetic in `Stage/push-nav`. Two tabs at the foot said the halves were peers and spent 60pt of an 844pt screen saying it about a switch nobody makes twice an hour.

`codePushed(contentFocus, docked)` is the whole state, and it is derived rather than stored beside `contentFocus`: "code has the stage" is the same fact the desktop's Focus toggle states, so ⌘\`, `jumpToTerminal` and the code header's own back button are already writing it, and a phone-only flag would be a second answer to one question. One consequence worth knowing: `contentFocus` is a per-client preference, so a phone remembers which screen it was on — a fresh client with no stored value starts at "code", and one tap of Back is what teaches it otherwise.

Three ways in and out, and they are the platform's:

- **In** is the `</>` in the terminal strip's trailing group. A button, not half of a segmented control — the screen it pushes carries its own way out.
- **Out** is "‹ Terminal" at the top-left of that screen (`Stage/CodeHalfHeader`'s `NavBack`, which is also the "‹ Files" the narrow code half already had), and a **swipe from the left edge**. The swipe follows the finger and commits past a third of the width or on a flick; anything else springs back. Its listeners are native and non-passive, because React attaches `touchstart`/`touchmove` passively at the root and a synthetic handler could not stop the list underneath scrolling sideways.
- The **positions** are inline transforms from `pushTransforms`, at rest and at every frame of a drag alike. That is what lets a finger take the screen over mid-transition and hand it back without a seam: letting go paints the resting progress of wherever it is going, and the render that follows sets the identical values, so nothing has to be cleared and nothing can snap home for a frame. Only the duration and the curve are CSS (`.nav-push` in `index.css`), since a drag has neither.

The edge swipe pops the **code screen**, not the file open inside it — that one has "‹ Files" in the same corner and the file stays selected, so pushing Code again returns to it. One gesture, one meaning; the alternative was a swipe whose destination depended on what the half happened to be showing.

Reduced motion gets a crossfade rather than a slide, and the drag stops following the finger. The `.nav-crossfade` duration is `!important` because `index.css`'s blanket reduced-motion rule zeroes every transition on the page — right for decoration, wrong for the one transition that is telling you the screen changed.

Two other things went with the tab bar. The strip's ⌘K hint and its A−/A+ steps are now a **search icon in the queue drawer's header** (the palette's `go` mode — a phone has no chord to press) and the **`⋯` overflow sheet** (`Terminal/TerminalOverflowSheet` on `ui/action-sheet`: text size, fit, new shell, close). And the terminal's session tabs are a snapping pill row, with the current one scrolled to the centre, because at 390px a strip that divides its width between every tab gives each of them slivers.

A cold start at a URL is the PWA's normal case and used to lose the file — `ReviewRoute` treated "repo still resolving" as "no repo", and `useRepositoryInit`'s clean-route normalization dropped the `/file/...` segment. Both now preserve a location already inside the review being opened.

The one list in the sidebar that isn't the queue is the **pull-requests drawer** (`Sidebar/PullRequestsDrawer`, rules in `Sidebar/pr-drawer.ts`), collapsible at the foot above agent usage. It shows the viewer's open PRs **minus** the ones a workspace already stands for, minus the repos filtered out in its header popover — so its count is a count of work not yet picked up; an active repo filter shows as the funnel icon staying lit (its tooltip carries the hidden-repo count), and it keeps the drawer from claiming "no PRs" when everything is merely filtered. Clicking a row is the gesture that moves one across: `openRowInWorkspace` on the tree's own row for that PR, the same verb ⌘K's Enter uses.

Three joins make that safe, and all three go through the sidebar tree rather than re-reading the PR snapshot — `stores/selectors/sidebar.ts` owns them, cached on tree identity. `availablePrs` is the one gate on a logged-out `gh` (its cached PRs must be ignored everywhere, or a card badges what the row below it discarded). `sidebarRowsByRepoRef` indexes rows by repo and _branch_, which is what an attachment names — that is how a PR branch that hasn't been fetched yet is badged rather than called _gone_, and it is what `attachmentPr`/`attachmentRow` in `workspace-status` read. `sidebarRowsByPr` indexes rows by the PR they stand for, so the drawer never re-derives a join the tree already made. A PR whose repo isn't cloned here stays listed and opens in the browser — there is no clone-on-click.

**Red means a reviewer asked for changes, and nothing else** (`prNeedsAttention`). CI state is reported in words — the badge tooltip, the card's phrase — but never in the colour: red CI is common and often not yours to fix, so counting it painted most of a long-lived PR list red, and a colour that is usually on says nothing.

Slices that need backend access receive an `ApiClient` via `SliceCreatorWithClient<T>`. Slices needing persistence receive a `StorageService` via `SliceCreatorWithStorage<T>`.

## UI Preferences

Stored globally via Tauri Store (persists across all repositories, stored in Tauri's app data directory):

- Font size, theme, and split sizes (`tabRailWidth`, `filesPanelWidth`, `diffSplitFraction`)
- `workspaceSeenAt` — when each workspace was last focused, epoch ms
- `lastWorkspaceId` — the workspace the stage was showing, so a relaunch comes back to it
- `terminalTabLayout` — the terminal strip's tabs, active tab, and tab recency

`workspaceSeenAt` is what makes an attention signal _unseen_. `attentionSignalAt` (in `Sidebar/workspace-status`) is the newest moment a workspace did something that wants a person — a terminal stopped and waiting, a PR asking for changes or failing CI, a merge — and `isUnseen` compares it against that entry. A card carrying an unseen signal wears an accent bar on its outer edge; `focusWorkspace` writes the timestamp, so **looking at it is the acknowledgement** and there is no dismiss gesture. Its one `acknowledge: false` caller is the launch restore, because an app coming back up on its own is nobody looking — `useAttentionBadge` clears the signal when the window actually has focus, which is the same rule stated the other way round. It lives in preferences and never in `work.json`: this is a fact about one pair of eyes, not about the work, and a second machine reasonably has its own answer.

`terminalTabLayout` is the largest thing in here, and the split is the point: the **sessions** are the daemon's record and are never written to it, while **which sessions share a tab and how that tab is split** is this window's own answer and lives nowhere else. So it stores grouping and geometry only, and the restore is reconciled against the daemon's session list rather than trusted — panes whose session died while the app was closed are pruned, and a session the layout never saw still gets a tab. It is read back as unverified JSON (`sanitizeTabs` in `components/Terminal/pane-tree.ts`), and saving is held until that restore has run, or startup's flat tab-per-session list would overwrite the layout it is about to replace. One consequence worth knowing: preferences are per-client, so a phone attached over the tailnet keeps its own grouping rather than mirroring the desktop's.

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

All three are mounted on the **app shell** (`AppShell` in `router.tsx`), never inside the review screen — a command has to answer wherever the app is, and `ReviewView` is only drawn on the three repo routes. `menuParity.test.ts` guards it.

Shortcuts are described by `KeyboardEvent.code`, never `key`: on macOS Option+C reports `key === "ç"`, so any Alt binding tested against `key` silently never fires.

Adding a command means adding one entry to `APP_COMMANDS` — or to `TERMINAL_COMMANDS` in `components/Terminal/commands.ts` / `WORKSPACE_COMMANDS` in `commands/workspaceCommands.ts` for the ones those own, both of which the menu-parity test also reads. Adding a _menu_ entry additionally means a `MenuItemBuilder` in `mod.rs` and a `MENU_COMMANDS` line.

**⌘T is `terminal.new`**: a terminal in the focused workspace, from anywhere, with no dialog ever. It is `openTerminalTab(focusedWorkspace(...))` and nothing else — the cwd follows the repo tab on screen (its first tab otherwise), and with no workspace focused, or one showing no repo, it names no directory at all, so the backend starts in `$HOME` and the router places the session by cwd exactly as it would a shell started outside the app. There is nothing else it could open: the app has no tabs and no second window. **⌘N is `workspace.new`**, the other half of that — a fresh card in the queue, focused, empty.

**⌘W is a cascade**, run by `handleClose` in `router.tsx`: the focused terminal pane, else the split, else the file — and when nothing is left, the window itself.

Its **first** rung asks `closeFocusedTerminal` (`components/Terminal/close.ts`), which resolves the terminal the same way ⌘T resolves a workspace: DOM focus if a pane has it, otherwise **what the panel is showing**. Reading `document.activeElement` alone is what made the keystroke unreliable — focus sits on `body` after a dialog or the palette, and in the sidebar for as long as it takes to read a card, none of which is leaving the shell, and each of which used to send ⌘W straight down the cascade. The code half holding the content region is the one thing that still decides against the terminal; in the shared view, where both halves are on screen, focus arbitrates and the panel's own chrome (`data-terminal-panel`) counts as being in it.

Its **last** rung confirms first (`utils/close-window.ts`). Everything above it is a small undo; the window is not, and ⌘W reaches it precisely by falling through everything the keystroke was probably aimed at. The prompt names the terminals that outlive it, because they are the daemon's and closing the window kills none of them.

Closing a terminal at all — by ⌘W, the pane ×, the tab ×, or a menu verb over several — goes through `closeTerminals`, which asks first when a session looks busy: a named foreground command ("zsh is running `npm test`"), or a `working` phase with no name, which is the same fact with `ps` unable to supply it. A prompt is not work and a bare bell is not either, so neither asks.

`lib/fuzzy/` is the one fuzzy matcher — a Smith-Waterman DP producing scores normalized to 0..1, so several weighted fields and an extrinsic boost can be blended without one term swamping the others.

### The palette's five modes

⌘K, ⌘P and ⌘R are one dialog, not three. `activeOverlay === "palette"` plus a `PaletteMode` (`go` / `files` / `commands` / `symbols` / `content`) is the whole state; each shortcut calls `openPalette(mode)`. Prefixes switch modes in place — `/` files, `>` commands, `@` symbols, `#` in files, nothing for `go` — and Backspace on an empty query steps back, falling to `go` when there is nothing to unwind. See `components/palette/modes.ts` for why a prefix is only read out of an _empty_ box.

`go` is where ⌘K lands and the app's only navigation surface: workspaces, every branch the sidebar tree knows, and every running terminal. It navigates and nothing else — creating a workspace is ⌘N (or the sidebar's `+`), and opening a repo in one is the repo strip's. A branch row carries the **router preview** — "→ joins <workspace>" or "→ new workspace" — decided by `previewRouteIn` (`stores/selectors/workspaceData.ts`) against the attachments already in the store rather than reading the queue off disk per keystroke; `route-preview.ts` only supplies the wording. It mirrors the backend's heuristic: the first workspace in queue order showing that repo, else a new one. A wrong guess is cheap — nothing was taken from anyone, and the terminal can be dragged. Branch and terminal rows are capped at `MAX_RESULTS`; workspaces never are.

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
- `Sidebar/` — The chrome sidebar: the workspace queue, its two densities, the pull-requests drawer, and the shared verbs (`workspace-actions`, `workspace-drag`, `workspace-status`)
- `Stage/` — The focused workspace's frame: the code half's repo tab strip, the repo picker, and the empty state. Nothing sits above the two halves — the sidebar card is where a workspace's identity, status and progress are read
- `ui/` — Shared primitives (dialog, popover, tooltip, tabs, etc.)

Top-level components: `ReviewView.tsx` (main review screen), `ComparisonPickerModal.tsx`, `SettingsModal.tsx`, `DebugModal.tsx`.

## Hooks

`hooks/` holds the lifecycle and cross-cutting concerns — loading a comparison, watching files, keyboard navigation, scroll tracking, the poll-while-visible syncs. Named for what they do; read the directory rather than a list here, which only ever named a tenth of them.
